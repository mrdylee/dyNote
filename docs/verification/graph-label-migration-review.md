# Graph label migration review — v0.6.2

Reproduced two failures before fixing: disabled legacy labels became visible at higher zoom, and the old 0.1 setting was clamped to threshold 3, changing opacity. Introduced a persisted `showLabels` boolean (default true) and extended the threshold upper bound to 4, which accommodates -log2(0.1). Existing current-format settings take precedence. Legacy zero migrates to false; toggling visibility does not rebuild physics.

The prior focused/hovered-label behavior is retained and explained in the UI. Already-lossy v0.6.0/v0.6.1 migrations cannot be recovered without original values; the UI toggle allows manual correction without guessing which threshold-3 settings were disabled.

Tests cover every legacy slider setting 0..3 in 0.1 increments at zoom 0.015, 0.4, 1, 2.25, 3, 6, save/reload normalization, explicit boolean precedence, and preservation of existing threshold-3 settings. Runtime checks cover actual canvas differences, no additional graph Worker posts, remount/reload/reset, and actual UI migration of legacy 0 and 0.1. No physics or edge mesh implementation was changed.
