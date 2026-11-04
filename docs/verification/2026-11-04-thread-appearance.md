# Bullet Threading width and opacity

Matched the upstream plugin runtime defaults by changing both connector borders from 1.5px to 2px and explicitly setting opacity to 1. The existing opaque purple color remains. This is a journal/selected-region CSS change only.

Reference correction: the [theme stylesheet](https://github.com/pengx17/logseq-dev-theme/blob/main/bullet_threading.css) has a 1px fallback, but the [plugin implementation](https://github.com/pengx17/logseq-plugin-bullet-threading/blob/master/src/main.ts) sets its width override from the plugin setting, whose fallback and settings-schema default are 2px. The earlier 1px comparison checked only the stylesheet fallback. The plugin and stylesheet do not add an opacity reduction; the connector uses the active theme color, which a custom theme or user color can change.

Fresh computed-style observations from synthetic native Electron profiles confirmed both the daily journal and an ordinary document's journal region have vertical and horizontal borders of 2px, local opacity 1, cumulative ancestor opacity 1, opaque rgb(142,112,188), no filter, and normal blend mode. Receipts: ignored `output/verification/thread-appearance-journal.json` and `thread-appearance-document.json`.

`npm run build` passed. Existing native journal-threading checks passed all 14 grouped checks; selected normal/journal region checks passed all 9 grouped checks, with zero renderer errors. Temporary copies of the existing scenarios collected computed styles without adding implementation-mirroring unit tests. Screenshots are under `output/playwright/thread-appearance/` and `output/playwright/outline-regions/`. Diff checks passed. The pre-existing large-bundle advisory remains.

This validates the local macOS source build and matches the plugin defaults for thickness/opacity. It does not claim identical colors under every Logseq theme or replace the installed application.
