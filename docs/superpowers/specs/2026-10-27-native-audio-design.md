# Native audio recording and playback

Approved core-plugin scope includes audio recording enabled in the personal vault. Native recording starts only after the user clicks Record. Permit microphone audio only for the exact main application frame; camera/unknown/subframe/remote requests remain denied. Keep OS microphone permission behavior and add macOS usage text to packaging.

Record WebM/Opus with MediaRecorder. Stop-and-save imports the bounded audio attachment through existing validated Vault.importAttachment and adds a wiki embed to the originating Markdown note. Playback uses a local Blob URL and audio controls; no upload occurs through this feature. Existing configured Git backup applies to supported vault files. Support valid WebM/WAV/MP3/Ogg/M4A attachment signatures, preserve bytes on import/restore, and reject disguised/oversized files.

Recording/requesting/unsaved states block accidental modal/app closure and other modal shortcuts. Explicit Cancel stops/disposes tracks and discards only the in-memory recording; Stop and Save waits for final chunks and import. Unmount or a late getUserMedia result stops tracks. Failed saves retain the recording for retry. No actual personal microphone signal is needed for automated verification: use Chromium's synthetic media device only in the test process.

V-model: media-origin/type permission and audio signature tests -> native recorder/playback -> real Electron with fake-device audio, disk byte/header checks, note-link roundtrip, playback metadata and cancel cleanup. Physical microphones, packaged OS consent and Windows execution remain separate proof.
