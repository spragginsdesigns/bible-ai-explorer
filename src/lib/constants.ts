// Stable GitHub Releases URL for the SureWord Android APK. Every release
// attaches its APK under the fixed asset name `SureWord.apk` (see
// mobile/README.md), so this link always serves the latest build.
export const ANDROID_APK_URL =
	"https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.apk";

// Stable GitHub Releases URL for the SureWord macOS DMG. Every macOS release
// attaches its DMG under the fixed asset name `SureWord.dmg` (see
// macos/README.md), so this link always serves the latest build.
export const MACOS_DMG_URL =
	"https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.dmg";

// Versions shown on the download cards. The links above always serve the
// latest build regardless of these, so a stale value here misinforms rather
// than breaks — bump them with the release:
//   Android → `mobile/app.json` `expo.version`
//   macOS   → `macos/project.yml` `MARKETING_VERSION`
// Both release checklists say so (`mobile/README.md`, `macos/README.md`).
export const ANDROID_VERSION = "1.18.0";
export const MACOS_VERSION = "1.3.0";
