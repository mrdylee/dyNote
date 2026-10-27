# Native web viewer

Approved core-plugin scope includes the personal vault's web viewer. Add an explicit URL dialog and open HTTP/HTTPS in a native child browser window. Remote pages use an independent in-memory session, no preload/native bridge, sandbox/context isolation and no Node integration. Keep the note renderer's network blocking unchanged. Remote media/clipboard/native permissions, downloads, popups and non-web navigation are denied.

Validate URL schemes/credentials through existing safeExternalUrl plus an HTTP/HTTPS-only check. Show the current hostname in the child title; prevent page scripts spoofing the window title. Close owned child windows when the main note window closes. Failed loads close the empty child and report an error. This is a basic reading window, not a full browser/session/download manager.

V-model: reject executable/file/mail/credential URLs -> isolated native child -> actual local HTTP fixture verifies text, absent window.notes/require and sandbox settings; remote microphone/native notes requests cannot gain privileges. No personal websites/accounts are needed for verification.
