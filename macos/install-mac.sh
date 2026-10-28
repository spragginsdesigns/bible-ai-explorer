#!/usr/bin/env bash
# Build SureWord for macOS from the current checkout and install it as THE
# copy on this Mac: /Applications/SureWord.app. Nothing else on the machine
# should be a SureWord.app that Spotlight can find.
#
#   bash macos/install-mac.sh            # build Release → replace /Applications/SureWord.app → launch
#   bash macos/install-mac.sh --release  # …then notarize the app/DMG and publish macos-v<version> on GitHub
#   bash macos/install-mac.sh --no-launch
#
# This is the mandatory last step of any macOS parity work (see CLAUDE.md →
# Workflow). Why it exists: parity work used to be built into scratch
# directories (macos/build, build-lane2…, DerivedData) and never installed, so
# Spotlight listed a dozen SureWord.app copies and the one in /Applications was
# ten days stale. Now:
#
#   * every build lands in a `*.noindex` directory - Spotlight skips those, so
#     `⌘Space sureword` only ever finds /Applications/SureWord.app;
#   * stale build dirs without the suffix, agent-fleet lane dirs and Xcode's
#     DerivedData copy are deleted on every run;
#   * the installed app is verified to report project.yml's MARKETING_VERSION.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
project_file="$script_dir/project.yml"
build_dir="$script_dir/build-release.noindex"
built_app="$build_dir/Build/Products/Release/SureWord.app"
installed_app="/Applications/SureWord.app"

do_release=0
do_launch=1
for arg in "$@"; do
	case "$arg" in
	--release) do_release=1 ;;
	--no-launch) do_launch=0 ;;
	-h | --help)
		sed -n '2,20p' "$0"
		exit 0
		;;
	*)
		printf 'install-mac: unknown argument %s\n' "$arg" >&2
		exit 2
		;;
	esac
done

die() {
	printf 'install-mac: %s\n' "$*" >&2
	exit 1
}
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

command -v xcodegen >/dev/null 2>&1 || die "xcodegen is required (brew install xcodegen)"
command -v xcodebuild >/dev/null 2>&1 || die "xcodebuild is required (install Xcode)"
[ -x /usr/libexec/PlistBuddy ] || die "PlistBuddy is required"
[ -f "$project_file" ] || die "missing $project_file"

version="$(sed -nE 's/^[[:space:]]*MARKETING_VERSION:[[:space:]]*"?([^"[:space:]]+)"?[[:space:]]*$/\1/p' "$project_file" | head -n 1)"
[ -n "$version" ] || die "MARKETING_VERSION is missing from $project_file"

# ---------------------------------------------------------------------------
step "Pruning stray SureWord build products"
# Anything Spotlight can index is a trap. Build dirs without the .noindex
# suffix, the agent-fleet lane dirs, and Xcode's own DerivedData copy all go.
for d in "$script_dir"/build "$script_dir"/build-ios "$script_dir"/build-release \
	"$script_dir"/build-lane* "$script_dir"/build-ios-lane* "$script_dir"/build-merge; do
	[ -e "$d" ] || continue
	case "$d" in *.noindex) continue ;; esac
	printf '  rm -rf %s\n' "${d#"$repo_root"/}"
	rm -rf "$d"
done
for d in "$HOME"/Library/Developer/Xcode/DerivedData/SureWord-*; do
	[ -e "$d" ] || continue
	printf '  rm -rf %s\n' "$d"
	rm -rf "$d"
done

# ---------------------------------------------------------------------------
step "Building SureWord $version (Release)"
(cd -- "$script_dir" && xcodegen generate >/dev/null)
# Snapshot macos/ before xcodebuild reads it and, once the build succeeds,
# record that snapshot next to the app with the app's CDHash. build-dmg.sh
# packages only an app whose record matches it and the current source, so a
# DMG can never be made from a stale or replaced build. The old record is
# removed first so a failed build cannot leave it describing an older app.
# shellcheck source=../scripts/lib/release-provenance.sh
. "$repo_root/scripts/lib/release-provenance.sh"
rm -f "$built_app.build" "$built_app.sources"
build_sources="$(mktemp)"
trap 'rm -f "$build_sources"' EXIT
release_source_listing "$repo_root" macos >"$build_sources"
build_commit="$(git -C "$repo_root" rev-parse HEAD)"
build_dirty="$(release_source_dirty_count "$repo_root" macos)"
# Keep the host's push profile/entitlements target-specific: a global
# CODE_SIGN_ENTITLEMENTS or profile override would also re-sign the embedded
# Share extension with the host's incompatible capabilities and identifier.
push_settings=()
if [ -n "${SUREWORD_MAC_PUSH_PROFILE:-}" ]; then
	push_settings+=("SUREWORD_MAC_PUSH_PROFILE=$SUREWORD_MAC_PUSH_PROFILE")
	push_settings+=("SUREWORD_MAC_ENTITLEMENTS=SureWord/SureWordPush.entitlements")
	push_settings+=("SUREWORD_APS_ENVIRONMENT=${SUREWORD_MAC_PUSH_ENVIRONMENT:-production}")
	push_settings+=("CODE_SIGN_IDENTITY=${SUREWORD_MAC_PUSH_IDENTITY:-Developer ID Application}")
fi
(cd -- "$script_dir" && xcodebuild -project SureWord.xcodeproj -scheme SureWord \
	-configuration Release -destination 'platform=macOS' \
	-derivedDataPath "$build_dir" ${push_settings[@]+"${push_settings[@]}"} build -quiet) || die "xcodebuild failed"
[ -d "$built_app" ] || die "build produced no app at $built_app"

built_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$built_app/Contents/Info.plist")"
[ "$built_version" = "$version" ] ||
	die "built app reports $built_version but project.yml declares $version"
if ! release_record_app_build "$built_app" "$build_sources" "$build_commit" "$build_dirty"; then
	[ "$do_release" = 0 ] || die "could not record which source $built_app was built from; nothing was published"
	printf '  note: no build record written; this app cannot be packaged for release\n'
fi

# ---------------------------------------------------------------------------
step "Installing to $installed_app"
# Simulator apps have the same executable name. Quit only the installed Mac
# binary so another agent's iOS test session survives a desktop release.
installed_process='^/Applications/SureWord[.]app/Contents/MacOS/SureWord([[:space:]]|$)'
if pgrep -f "$installed_process" >/dev/null 2>&1; then
	printf '  quitting running SureWord\n'
	osascript -e 'tell application id "com.spragginsdesigns.sureword" to quit' >/dev/null 2>&1 || true
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		pgrep -f "$installed_process" >/dev/null 2>&1 || break
		sleep 0.5
	done
	pkill -f "$installed_process" >/dev/null 2>&1 || true
fi
rm -rf "$installed_app"
ditto "$built_app" "$installed_app"
xattr -dr com.apple.quarantine "$installed_app" 2>/dev/null || true
codesign --verify --deep --strict "$installed_app" ||
	die "installed app failed signature verification"

installed_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$installed_app/Contents/Info.plist")"
installed_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$installed_app/Contents/Info.plist")"
[ "$installed_version" = "$version" ] || die "installed app reports $installed_version, expected $version"
printf '  installed SureWord %s (%s) from %s\n' "$installed_version" "$installed_build" "$(git -C "$repo_root" rev-parse --short HEAD)"

# ---------------------------------------------------------------------------
step "Checking Spotlight for other SureWord.app copies"
# mdfind lags a little after deletes; report what it still sees so a stray
# copy elsewhere on disk (Downloads, a mounted DMG, …) is visible, not hidden.
strays="$(mdfind "kMDItemFSName == 'SureWord.app'" 2>/dev/null | grep -Fxv "$installed_app" || true)"
if [ -n "$strays" ]; then
	printf '  still indexed (delete or eject these; deleted dirs drop out of the index shortly):\n'
	printf '    %s\n' $strays
else
	printf '  only %s\n' "$installed_app"
fi

# ---------------------------------------------------------------------------
if [ "$do_release" = 1 ]; then
	step "Notarizing and publishing DMG for macOS $version"
	bash "$script_dir/notarize-mac.sh"
	bash "$script_dir/release-dmg.sh"
fi

if [ "$do_launch" = 1 ]; then
	step "Launching"
	open "$installed_app"
fi

printf '\nSureWord %s is installed at %s\n' "$version" "$installed_app"
