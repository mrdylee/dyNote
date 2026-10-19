# Live Preview phase 1

Approved scope: headings, emphasis, strike, inline code, lists, Markdown/wiki links, task checkboxes and local raster images. Tables, PDF embeds, math, Mermaid and callout widgets remain source text in this mode; existing reading/split views remain available.

Use one CodeMirror EditorView and a Compartment to switch source/live rendering. Markdown remains the sole saved representation. Decorations hide syntax only outside selection ranges; editing reveals the relevant token. Selection, history and scroll survive source/live switches. Checkbox changes are ordinary undoable transactions. Links use Cmd/Ctrl-click so ordinary clicks can edit source. Image clicks reveal their Markdown.

A syntax-tree-based decoration field owns ranges and widget lifetimes. Code, frontmatter, HTML and unsupported table blocks remain literal. During IME composition, map existing decorations without recreating widgets; refresh after composition finishes. Reuse the vault attachment resolver and custom protocol, never load remote images or interpret HTML. Integrate the existing autosave queue and link routing.

Validate document identity, selective reveal, nested syntax, excluded regions, checkbox undo/read-only, safe image URLs and composition transitions with tests. Validate the built Electron app with a disposable vault: editing, source/live toggling, links, images, save and reopen. Synthetic Korean/composition checks do not establish native Windows IME behavior.
