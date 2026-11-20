# Review fixes and installed Windows updates

Assumption: automatic installation targets the existing per-user Windows x64 Setup distribution. ZIP distributions retain their existing manual replacement flow.

1. Review temporary document lifecycle and preserve the last edit on close, startup loading and vault changes. Verify using an isolated Electron profile.
2. Add verified installer staging and an external Windows helper that waits for graceful app exit, runs Setup without a reboot, and relaunches Dynote. Test corrupted downloads, launch failures, cancellation and persisted attempt suppression.
3. Enable automatic installation by default for installed Windows apps, with an off switch, Install now and Later. Wait for 60 seconds without input and no AI, recording, dialogs or mutations. Use the existing close/save handshake and prevent repeated automatic attempts of a failed version.
4. Run tests, build and Electron regressions. Exercise Windows Setup in an isolated environment if available; distinguish simulated lifecycle coverage from actual Windows installation. Do not publish or modify the user's installed app.

Installer command semantics: https://jrsoftware.org/inno-setup/documentation/topic_setupcmdline.htm . The existing `skipifsilent` Run entry prevents a second relaunch; the helper owns relaunching.
