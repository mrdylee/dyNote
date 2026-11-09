# Temporary opening for all readable files

The user extended File Open and Explorer drop support from DOCX to Markdown and every readable file type. Keep one independent read-only preview without changing the current vault or the original file.

- Use existing viewers for Markdown, Word, PDF, PNG/JPEG/GIF/WebP, WebM/WAV/MP3/OGG/M4A, Canvas and Bases. Read other UTF-8 text as escaped plain text; reject binary/invalid UTF-8 instead of guessing an Office format.
- Select a file through the existing menu/button or drop one native file anywhere. All native file drops now preview; internal document/tree drags retain their previous behavior. Paste and explicit attachment import remain available.
- Preserve original bytes in a private temporary copy and refresh from the original on focus. Keep the existing source and temporary cleanup guarantees.
- Markdown has no fixed size limit, matching existing note handling. Canvas/Bases retain 8 MiB; Word, media and other text retain 25 MiB.
- The original default-app action is available for recognized document/media and common text data extensions. Unknown text/source/script extensions can be read but are not launched through their default executable association.
- Canvas file references and Bases data remain independent of the selected vault. Show source text as needed; do not resolve them against unrelated personal/team data.
- Publish the complete readable-file flow in v0.22.1 after cross-platform verification. The earlier Word-only attempt was not published.
