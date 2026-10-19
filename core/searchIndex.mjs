// Derived from open-obsidian searchIndex.ts, MIT, copyright 2026 open-obsidian contributors.
// Source: d6601440e1cd3dc049c6f81cb48903e0df61d047; see THIRD_PARTY_NOTICES.md.
/**
 * Incremental full-text index.
 *
 * An inverted index over an in-memory document map. Adding or updating a note
 * only touches that note's postings, so the index stays current without a
 * rebuild — which matters because open-obsidian re-indexes on every keystroke
 * debounce and on every vault file event.
 *
 * Query syntax (a deliberately small subset that the search box advertises):
 *   word            term, matched case-insensitively
 *   "two words"     phrase, matched literally
 *   tag:project     restrict to notes carrying that tag (`*` wildcards allowed)
 *   path:notes/     restrict to paths containing this substring
 *   -word           exclude notes containing the term
 */
const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
/** Split text into index terms; CJK runs are emitted as chars and bigrams. */
export function tokenize(input) {
    const lowered = input.toLowerCase();
    const tokens = [];
    let buffer = '';
    const flush = () => {
        if (buffer !== '') {
            tokens.push(buffer);
            buffer = '';
        }
    };
    for (let i = 0; i < lowered.length; i += 1) {
        const ch = lowered[i];
        if (CJK.test(ch)) {
            flush();
            tokens.push(ch);
            const next = lowered[i + 1];
            if (next && CJK.test(next))
                tokens.push(ch + next);
            continue;
        }
        if (/[a-z0-9_]/.test(ch)) {
            buffer += ch;
            continue;
        }
        flush();
    }
    flush();
    return tokens;
}
export function parseQuery(raw) {
    const parsed = { terms: [], phrases: [], excluded: [], tags: [], paths: [] };
    const pattern = /(-?)"([^"]+)"|(-?)(\S+)/g;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
        const negated = match[1] === '-' || match[3] === '-';
        const value = match[2] ?? match[4] ?? '';
        if (!value)
            continue;
        const lower = value.toLowerCase();
        if (lower.startsWith('tag:')) {
            parsed.tags.push(lower.slice(4));
            continue;
        }
        if (lower.startsWith('path:')) {
            parsed.paths.push(lower.slice(5));
            continue;
        }
        if (match[2] !== undefined) {
            (negated ? parsed.excluded : parsed.phrases).push(lower);
            continue;
        }
        for (const token of tokenize(value)) {
            (negated ? parsed.excluded : parsed.terms).push(token);
        }
    }
    return parsed;
}
export class SearchIndex {
    docs = new Map();
    postings = new Map();
    lengths = new Map();
    tagSets = new Map();
    k1 = 1.2;
    b = 0.75;
    get size() {
        return this.docs.size;
    }
    stats() {
        let postings = 0;
        for (const entry of this.postings.values())
            postings += entry.size;
        return { documents: this.docs.size, terms: this.postings.size, postings };
    }
    clear() {
        this.docs.clear();
        this.postings.clear();
        this.lengths.clear();
        this.tagSets.clear();
    }
    has(id) {
        return this.docs.has(id);
    }
    get(id) {
        return this.docs.get(id);
    }
    all() {
        return [...this.docs.values()];
    }
    /** Insert or replace a document. Replaces incrementally — never rebuilds. */
    add(doc) {
        if (this.docs.has(doc.id))
            this.remove(doc.id);
        const terms = tokenize(`${doc.title} ${doc.text}`);
        const counts = new Map();
        for (const term of terms)
            counts.set(term, (counts.get(term) ?? 0) + 1);
        for (const [term, count] of counts) {
            let entry = this.postings.get(term);
            if (!entry) {
                entry = new Map();
                this.postings.set(term, entry);
            }
            entry.set(doc.id, count);
        }
        this.docs.set(doc.id, doc);
        this.lengths.set(doc.id, terms.length || 1);
        this.tagSets.set(doc.id, new Set(doc.tags.map((t) => t.toLowerCase())));
    }
    /** Add or update many documents in one pass. */
    addAll(docs) {
        for (const doc of docs)
            this.add(doc);
    }
    remove(id) {
        if (!this.docs.has(id))
            return false;
        for (const [term, entry] of this.postings) {
            if (entry.delete(id) && entry.size === 0)
                this.postings.delete(term);
        }
        this.docs.delete(id);
        this.lengths.delete(id);
        this.tagSets.delete(id);
        return true;
    }
    matchesTag(tagSet, pattern) {
        if (pattern === '*')
            return tagSet.size > 0;
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            for (const tag of tagSet)
                if (tag.startsWith(prefix))
                    return true;
            return false;
        }
        for (const tag of tagSet)
            if (tag === pattern || tag.startsWith(`${pattern}/`))
                return true;
        return false;
    }
    /**
     * Run a query. Returns the highest scoring matches with a highlighted snippet.
     */
    search(rawQuery, options = {}) {
        const query = parseQuery(rawQuery);
        const limit = options.limit ?? 50;
        const results = [];
        const hasFilters = query.tags.length > 0 || query.paths.length > 0 || (options.pathFilter ?? '') !== '' || (options.tagFilter ?? '') !== '';
        // With only filters and no text terms, return every matching document.
        if (query.terms.length === 0 && query.phrases.length === 0) {
            for (const doc of this.docs.values()) {
                if (!this.passesFilters(doc, query, options))
                    continue;
                results.push({
                    id: doc.id,
                    path: doc.path,
                    title: doc.title,
                    tags: doc.tags,
                    score: 0,
                    snippet: buildSnippet(doc, [], options).text,
                    highlights: [],
                    matchedTerms: [],
                });
            }
            return this.finish(results, options, limit, hasFilters);
        }
        const totalDocs = this.docs.size || 1;
        const avgLength = this.averageLength();
        const uniqueTerms = dedupe(query.terms);
        const scores = new Map();
        const termHits = new Map();
        // Terms are ANDed together: a document must contain every query term.
        for (const term of uniqueTerms) {
            const entry = this.postings.get(term);
            if (!entry)
                continue;
            for (const [docId, tf] of entry) {
                const docLength = this.lengths.get(docId) ?? 1;
                const idf = Math.log(1 + totalDocs / entry.size);
                const numerator = tf * (this.k1 + 1);
                const denominator = tf + this.k1 * (1 - this.b + (this.b * docLength) / avgLength);
                scores.set(docId, (scores.get(docId) ?? 0) + (idf * numerator) / denominator);
                let hits = termHits.get(docId);
                if (!hits) {
                    hits = new Set();
                    termHits.set(docId, hits);
                }
                hits.add(term);
            }
        }
        for (const phrase of dedupe(query.phrases)) {
            for (const doc of this.docs.values()) {
                const haystack = `${doc.title}\n${doc.text}`.toLowerCase();
                if (!haystack.includes(phrase))
                    continue;
                scores.set(doc.id, (scores.get(doc.id) ?? 0) + 2.5);
            }
        }
        const results2 = [];
        for (const [docId, score] of scores) {
            if (uniqueTerms.length > 0 && (termHits.get(docId)?.size ?? 0) !== uniqueTerms.length)
                continue;
            const doc = this.docs.get(docId);
            if (!doc)
                continue;
            if (!this.passesFilters(doc, query, options))
                continue;
            if (!this.passesExclusions(doc, query))
                continue;
            const matched = dedupe([...query.terms, ...query.phrases]).filter((t) => `${doc.title}\n${doc.text}`.toLowerCase().includes(t));
            const built = buildSnippet(doc, matched, options);
            results2.push({
                id: doc.id,
                path: doc.path,
                title: doc.title,
                tags: doc.tags,
                score,
                snippet: built.text,
                highlights: built.highlights,
                matchedTerms: matched,
            });
        }
        return this.finish(results2, options, limit, hasFilters);
    }
    passesFilters(doc, query, options) {
        const tagSet = this.tagSets.get(doc.id) ?? new Set();
        for (const pattern of query.tags)
            if (!this.matchesTag(tagSet, pattern))
                return false;
        const tagFilter = (options.tagFilter ?? '').toLowerCase();
        if (tagFilter && !this.matchesTag(tagSet, tagFilter))
            return false;
        const pathNeedle = (options.pathFilter ?? '').toLowerCase();
        if (pathNeedle && !doc.path.toLowerCase().includes(pathNeedle))
            return false;
        for (const needle of query.paths)
            if (!doc.path.toLowerCase().includes(needle))
                return false;
        return true;
    }
    passesExclusions(doc, query) {
        if (query.excluded.length === 0)
            return true;
        const haystack = `${doc.title}\n${doc.text}`.toLowerCase();
        return !query.excluded.some((term) => haystack.includes(term));
    }
    finish(results, options, limit, hasFilters) {
        if (hasFilters && results.every((r) => r.score === 0)) {
            results.sort((a, b) => a.title.localeCompare(b.title));
        }
        else if (options.sortByDate) {
            const mtimes = new Map([...this.docs.values()].map((d) => [d.id, d.mtime ?? 0]));
            results.sort((a, b) => (mtimes.get(b.id) ?? 0) - (mtimes.get(a.id) ?? 0));
        }
        else {
            results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
        }
        return results.slice(0, limit);
    }
    /** Mean document length in tokens, recomputed on every call so that
     *  incremental updates are reflected in the next scoring pass. */
    averageLength() {
        let total = 0;
        for (const length of this.lengths.values())
            total += length;
        return total / (this.lengths.size || 1) || 1;
    }
}
function dedupe(values) {
    return [...new Set(values.filter(Boolean))];
}
/** Build a snippet window and the match ranges inside it. */
export function buildSnippet(doc, terms, options) {
    const haystack = options.searchTitleOnly ? doc.title : `${doc.title}\n${doc.text}`;
    const lower = haystack.toLowerCase();
    const ranges = [];
    let first = -1;
    for (const term of terms) {
        const at = lower.indexOf(term);
        if (at === -1)
            continue;
        ranges.push({ start: at, end: at + term.length });
        if (first === -1 || at < first)
            first = at;
    }
    if (first === -1) {
        const text = haystack.slice(0, 180).replace(/\s+/g, ' ').trim();
        return { text: text.length < haystack.length ? `${text}…` : text, highlights: [] };
    }
    const window = 90;
    let start = Math.max(0, first - window);
    if (start > 0) {
        const space = haystack.indexOf(' ', start);
        if (space !== -1 && space < first)
            start = space + 1;
    }
    let end = Math.min(haystack.length, start + window * 2);
    if (end < haystack.length) {
        const space = haystack.lastIndexOf(' ', end);
        if (space > first)
            end = space;
    }
    const text = haystack.slice(start, end);
    const shifted = ranges
        .filter((r) => r.start >= start && r.end <= end)
        .map((r) => ({ start: r.start - start, end: r.end - start }))
        .sort((a, b) => a.start - b.start);
    return {
        text: `${start > 0 ? '…' : ''}${text.replace(/\s+/g, ' ')}${end < haystack.length ? '…' : ''}`,
        highlights: shiftForEllipsis(shifted, start > 0),
    };
}
function shiftForEllipsis(ranges, prefixEllipsis) {
    if (!prefixEllipsis)
        return ranges;
    return ranges.map((r) => ({ start: r.start + 1, end: r.end + 1 }));
}
/** Split a snippet into alternating plain / highlighted segments. */
export function segmentSnippet(snippet, ranges) {
    const merged = [...ranges].sort((a, b) => a.start - b.start);
    const segments = [];
    let cursor = 0;
    for (const range of merged) {
        const start = Math.max(cursor, Math.min(range.start, snippet.length));
        const end = Math.max(start, Math.min(range.end, snippet.length));
        if (start > cursor)
            segments.push({ text: snippet.slice(cursor, start), hit: false });
        if (end > start)
            segments.push({ text: snippet.slice(start, end), hit: true });
        cursor = end;
    }
    if (cursor < snippet.length)
        segments.push({ text: snippet.slice(cursor), hit: false });
    return segments;
}
