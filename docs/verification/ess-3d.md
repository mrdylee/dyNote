# ESS LINK 3D review and verification

Baseline: `fec71eaa6025c2824abf57eeb3573eff819d14e8` (v0.9.0). Scope: the approved ESS viewer tab, note connections, background removal, review fixes and desktop publication. The original ESS project is not edited. Its GLB is copied byte-for-byte from revision `86a11015d74e100e90c9e1aa7d4a22bb927b3e50`.

## Review findings and fixes

| Finding | Resolution and evidence |
| --- | --- |
| A plain model embed loses the existing behavior | Bundle existing Three.js source, model and shaders; test actual rendered rotation/zoom and door changes in Electron. |
| Same-origin frame could reach the parent's native bridge | Serve the viewer at distinct `notes://ess`; exact frame source/origin/schema validation; native operations still trust only the exact app main frame. Runtime confirms both absent `window.notes` and denied parent access. |
| Generic model access would broaden file exposure | Permit only `/ess/ess-container.glb` on the ESS host; test other paths, traversal, queries/fragments and native trust rejection. Note HTML still forbids iframe tags. |
| Rack ID alone would mix containers | `ess-01/rack-01` and `ess-02/rack-01` are distinct; actual save/selection checks prove isolation. |
| Same-vault snapshot install closed the 3D tab during rename | Reset tab/selection only on vault identity change; actual rename/move retains a reopenable tab and correct links. |
| Mesh ancestor name differs from the visual label | Use the actual `Battery_Rack_XX` node name; click the physical rack mesh in the real canvas and confirm note navigation. |
| Controller shortcut buttons could leave the note panel stale | Emit the same validated target for LCS/eBSC/switch shortcuts; exercise sixth-container controller/BPU targets. |
| Original dark scene conflicted with requested background removal | Alpha renderer, clear alpha zero, no scene background, transparent frame and host surface. Runtime checks GL attributes and CSS, with screenshots. Retain legible diagnostic card text. |
| Small embedded viewport had duplicate header and crowded controls | Hide the viewer header at short heights and reduce footer spacing. 1050×700 runtime checks horizontal overflow and button operation; smaller panels can scroll. |
| Packaging both public sources and built output duplicated the GLB | Exclude `public/` in packaging; require built model and Three.js license and compare model bytes. |

No Critical/Important findings remain after the local review pass. This is a local code/diff and execution review, not a claim of a separate review agent or a service named review-work.

## Automated and runtime evidence

- Targeted tests cover valid targets, malformed messages, body/BOM/CRLF and YAML property/comment preservation, idempotent link/unlink and corrupt metadata refusal.
- Full unit suite: 233 passed, zero failures/skips on the source verification run. Final release rerun is recorded in the release report.
- `scripts/verify-ess.mjs`: **15 grouped actual Electron checks** passed. Includes six containers; transparent renderer; rendered rotation/zoom/door change and vents; link save and physical marker/mesh click; target restoration; multiple related notes/unlink; restart/rename; external revision conflict; forged/malformed messages; failed GLB request/retry; WebGL context loss/recovery; all detail target types on container six; 1050px layout; frame destruction/close/reopen; real live vault switch. Zero renderer errors and zero remote renderer requests.
- `scripts/verify-planner.mjs`: **10 grouped regression checks** passed against the source build, including clipboard capture, adoption/evidence, drag/undo, persistence, conflicts, vault separation and compact layout.
- Screenshots and machine-readable records are local ignored artifacts under `output/playwright/ess/` and `output/playwright/ess-planner-regression/`. Fixtures are synthetic and isolated from personal notes.
- The packaged Mac rerun and package/archive evidence are recorded in [release verification](release-0.10.0.md).

## Limits

This is a bundled illustrative ESS viewer. No real equipment, actual Modbus writes, general GLB import, Unity runtime, physics accuracy or measured CAD is claimed. Diagnostics remain explicitly simulated. Note linking changes only the user's selected note metadata through the existing guarded save path. Camera and door state are reconstructed when the frame is reopened. Windows runtime requires actual Windows execution to establish support beyond package inspection.
