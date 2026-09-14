import { version } from "../../package.json";

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

// Legacy consumers (for example Settings) use these as a safe display
// fallback. The welcome download cards resolve current versions from
// `/api/native-releases` and never use a stale release number.
export const ANDROID_VERSION = "Latest";
export const MACOS_VERSION = "Latest";

// The web app's own version, from package.json. Shown in Settings → About,
// the way the Android About card shows its app version.
export const WEB_VERSION = version;
