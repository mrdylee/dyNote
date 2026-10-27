# Native PDF reading and link roundtrip

Parent approved scope includes PDF++ and Markmind PDF workflows. This independently testable PDF-01 slice adds selectable text, page/selection/annotation fragment navigation, link copying and Markdown backlinks. PDF byte editing, page manipulation and annotation creation remain distinct subsequent work; a link viewer must not be described as full PDF++ equivalence.

Observed installed PDF++ source uses `[[file.pdf#page=1&selection=4,0,5,20&color=red]]` and `#page=<page>&annotation=<id>`. Current Dynote discards attachment fragments during Markdown rendering and opens every PDF at page 1. Preserve the resolved attachment path plus original fragment through wiki links, Markdown links and editor links. Main-process reads still receive only the validated base path.

PDF.js TextLayer supplies browser text selection. Represent a selection as text-item start index/offset and end index/offset. Copy a page or selected-text link through a narrow trusted-frame clipboard operation. Reopen the page and restore valid text ranges; out-of-range/stale selections report an unavailable highlight instead of selecting unrelated text. Read existing PDF annotation rectangles through PDF.js and navigate to matching IDs without modifying source bytes.

Find backlinks through the existing Markdown link scanner/resolver; ignore fenced/inline-code examples and ambiguous paths. Native UI lists linked notes and allows returning to the source or following that precise PDF fragment. Keep the original bytes unchanged in this slice, including read/selection/copy/navigation.

V-model: exact fragment and Markdown preservation tests, selection validation and backlink resolution tests -> native viewer -> actual two-page PDF selection/copy/reopen plus byte comparison. Use a synthetic PDF fixture with known text and annotation, not personal documents.
