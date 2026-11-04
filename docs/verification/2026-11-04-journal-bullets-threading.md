# Journal heading bullets and Bullet Threading

The user requested a Logseq-style journal UI and confirmed Bullet Threading. REA reference analysis and Superpowers planning, root-cause investigation, test-first implementation, local code review and completion verification were used.

## Result

- Journal Live Preview uses 6px CSS circles. Measured circle/text center difference is 0.25 CSS px for H1, H2 and body text in the native fixture. Nested heading indentation uses the body font so heading size does not distort block ancestry positions.
- The focused block and its ancestors receive the active color. Rounded connectors follow actual rendered bullet/checkbox centers through the CodeMirror layer API. Cursor movement, continuation, indentation, undo, folding, resizing and scrolling refresh presentation without changing stored Markdown.
- Wrapped list text receives hanging indentation so a thread cannot run through the wrapped text. An ancestor outside the viewport retains its branch; its offscreen endpoint is estimated from the visible indentation and document geometry. Visible endpoints are measured from the DOM.
- Source editing and ordinary documents keep their existing rendering. The integration uses the existing journal extension and adds no package dependency or network-loaded plugin code.

## Reference evidence

REA controlled browser scenario `ev_80275886e591f72e01f70a8dc16bace17d9c8accab4bf0cfef844119959022e5` performed all 17 declared actions against https://app.logseq.com/ in a fresh temporary Chrome profile. The result reports complete requested captures, zero page errors and owned-browser cleanup. The final DOM records H1/H2 control sizes 28px/24px, and its screenshot shows small circles aligned with the heading rows. Portable evidence: ignored `output/verification/logseq-heading-bullets-rea.json`.

The [upstream Bullet Threading plugin](https://github.com/pengx17/logseq-plugin-bullet-threading) and [its CSS reference](https://github.com/pengx17/logseq-dev-theme/blob/main/bullet_threading.css) describe the active-ancestor path. The local implementation is independent and uses CodeMirror. The web observation does not establish full desktop Logseq equivalence or execution of the upstream plugin in Dynote.

## Fresh verification

- Before implementation, the native regression failed for the glyph-circle presentation and absent ancestor connectors. Follow-up native assertions exposed the heading center offset, wrapped-text overlap and unconnected task checkboxes; these were corrected and verified.
- `node --test tests/journal-outline.test.mjs tests/live-preview.test.mjs`: 24 passed.
- Final `npm test`: 373 passed, zero failed/skipped.
- Final `npm run build`: passed; existing large-bundle advisory remains.
- `scripts/verify-journal-threading.mjs`: 14 grouped checks passed, zero renderer errors. Checks cover H1/H2/body circles, exact ancestor ownership, cursor changes, continuation, checkboxes, indentation/undo, folding, resize, source-mode exclusion, wrapping/scrolling with offscreen ancestors, ordinary documents and byte-exact save/restart. Screenshots and receipt: ignored `output/playwright/journal-threading/`.
- Existing `scripts/verify-journal-outline.mjs`: 9 grouped checks passed, zero renderer errors. Includes Enter/Tab/Shift+Enter, split-parent ownership, folding, completion, raw AI edit hierarchy, legacy prose, ordinary documents, custom templates and restart. The provider was a deterministic fixture; no account or model request was made.
- `git diff --check` and Node syntax checks passed. Local diff review confirmed the implementation stays in `src/journal-outline.mjs` and journal-scoped CSS, with only the matching README, native scenario and documentation additions.

The Electron 44.9.1 runtime already declared by the project was restored from its existing local download cache for native checks. All scenarios used synthetic temporary profiles/vaults. This verifies the current source build on macOS, not a public release or an update of `/Applications/Dynote.app`.

## Follow-up: wider visual indentation

The user requested more space between Tab levels so the bullets stand apart. Journal Live Preview now expands the indentation whitespace with body-font-relative letter spacing, giving approximately 24px per two-space level at the default font instead of approximately 8px. Continuation paragraphs receive the same visual expansion for their owning block's indentation, and wrapped text reserves enough space for the wider thread path. Saved Markdown indentation and Tab/Shift+Tab commands are unchanged.

Fresh follow-up verification: 24 focused journal/live-preview unit tests passed; production build passed; all 14 native threading checks passed with zero renderer errors, including indentation/undo, wrapping, offscreen ancestors and exact save/restart. Screenshot review confirmed the wider separation and connected circles. Artifacts: `output/playwright/journal-spacing/`. This remains a source-build change; the installed application has not been replaced.
