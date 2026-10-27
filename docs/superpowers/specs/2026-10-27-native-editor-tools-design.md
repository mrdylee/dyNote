# Native editor tools design

Parent approved scope: native equivalents for enabled Obsidian plugins and core workflows. This slice implements OUTLINE-01 and DIAGRAM-01 through existing CodeMirror transactions, without changing Vault persistence or loading plugin code.

Original Outliner execution against `- Parent\n  - Child\n- Sibling\n` established that moving Parent down or Sibling up yields `- Sibling\n- Parent\n  - Child\n`; indenting Sibling adds two spaces and outdenting Child removes two. Static source also identifies folding and drag behavior. Preserve the subtree, list markers, task checkboxes, line endings and single-step undo; ignore list-looking text in fenced code/frontmatter. Boundary actions do nothing. Folding uses CodeMirror decorations and never changes saved text. Provide command palette and keyboard entry points. Drag handles and broader focus workflows remain separately tracked until verified.

Mermaid Tools has twenty diagram families and a cursor insertion toolbar. Dynote will expose a native dialog with family selection, an editable sample and insertion at the editor selection, with code fences outside a Mermaid block and body insertion inside one. Author original examples rather than copying plugin assets. Validate all supplied samples with the installed Mermaid parser. Rendering reuses DiagramPreview. Verify insertion and undo in the actual editor.

Data flow: command -> captured active editor and selection -> pure transformation -> one CodeMirror dispatch -> existing onChange/SaveQueue -> revision-checked save. Busy/read-only/pending Copilot states block mutation. Commands switch from read mode into edit mode only when needed; pending command delivery checks the target document. Existing clipboard/import/IME bindings remain intact.

V-model: OUTLINE-01 exact input/output, CRLF and fence tests correspond to actual Obsidian observations; editor runtime checks undo and fold/unfold without disk mutation. DIAGRAM-01 parser tests correspond to the twenty family choices; runtime checks selection insertion, rendering and undo. Whole-suite regression remains required.
