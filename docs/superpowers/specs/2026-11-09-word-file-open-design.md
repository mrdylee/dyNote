# External Word file opening

The user requested a File Open menu/button and opening a Word file dropped from Explorer through a temporary folder. This extends the existing read-only DOCX viewer.

## Selected approach

A temporary byte-for-byte copy is preferred over importing into a vault or viewing an arbitrary external path through vault APIs. A separate preview dialog keeps personal/team vault identity and the selected document intact, and also works without a usable vault. The existing Word converter and sanitizer remain unchanged.

- File > 파일 열기… (`CmdOrCtrl+O`) and a visible 파일 열기 button use one native DOCX picker.
- Dropping one `.docx` anywhere in the main window opens the same temporary preview. Existing internal drags and image/PDF drops keep their behavior. Multiple-file drops containing Word show an explicit one-file-at-a-time message.
- Preload resolves real dropped File objects with Electron `webUtils.getPathForFile`; it does not use the removed `File.path` field or expose a generic file-system reader.
- Main validates an absolute regular DOCX path, excludes Word lock files/symlinks, reads at most 25 MiB, and stores its exact bytes in an app-owned OS temporary directory. The renderer receives an opaque document ID, filename, revision, HTML and extracted text.
- The preview identifies the file as temporary. Refresh and application focus re-read the original after Word's atomic replacement saves. The default-app action opens the original source, preserving the previously requested Word/Polarion workflow.
- Temporary copies are deleted on normal application exit. The app never writes to the original or imports the temporary file into a vault. OS temporary-directory lifetime applies after a crash.
- No automatic AI transmission or new file associations are involved. This increment targets DOCX files from the current request.

## Verification

Unit tests prove exact copies, original preservation, refresh after replacement, cancellation/invalid ID errors, supported-path/size limits, malformed-file cleanup and temporary cleanup. A native Electron test verifies menu, button, a disk-backed File drop through preload, JavaScript-created File rejection, source-path handoff and refresh. Existing Word/vault tests and the full suite must remain green.
