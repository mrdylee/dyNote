# General Dynote UI and text colors

Remove ESS LINK navigation, tab, document action, rendering and its Vite entry from the general notebook. Keep existing note metadata intact. Remove the manual MCP/skills setup panel and the busy state that existed only for it; preserve AI provider integration and configured tools.

Use one compact text-color popover with 12 named presets, a native custom-color picker, and saved colors. Choosing a swatch selects the color; the existing Apply action changes the selected text. Save deduplicates colors and persists them in localStorage across notes, vaults and restarts on this installation. Each saved color can be removed. Color controls must preserve CodeMirror selection and respect read-only mode.

Inline swatches would crowd small editor panes; replacing all formatting controls would broaden scope. A popover limits the change to color selection. No new dependency, remote sync, AI configuration discovery or data migration.

Verify palette saving/removal and selection with the real editor, restart persistence, absence of removed controls, existing text-color rendering tests, AI integration tests and a production build.

## Screen eyedropper follow-up

Add an explicit `화면에서 색 가져오기` button using the supported `window.EyeDropper` API. It opens only on a user click, samples outside Dynote, and sets the current text color without automatically saving or editing the document. Keep the popover available after sampling so the user can save. Escape preserves the current color. Disable while sampling or read-only, explain unsupported environments, and show a concise error for other failures. Abort a pending picker when its component unmounts. Verify actual Chrome and desktop sampling on this Mac, then save and restart with an isolated profile. Windows remains unverified.
