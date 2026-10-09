#!/usr/bin/env bash
# Archive SureWord for iOS and upload it to App Store Connect (TestFlight).
#
#   bash macos/release-ios.sh              # archive, export, upload to TestFlight
#   bash macos/release-ios.sh --no-upload  # archive and export the .ipa only
#
# Signing: Apple Distribution (LineCrush Inc, team 389LLKGY3Y) from this Mac's
# login keychain, with an App Store provisioning profile per bundle id that
# macos/scripts/asc.py creates or reuses through the App Store Connect API. The
# per-target profile is chosen by a generated xcconfig keyed on TARGET_NAME, so
# project.yml keeps its Development signing for every local and simulator build.
#
# Version: MARKETING_VERSION from project.yml. Build number: the next unused
# number for that version in App Store Connect (CURRENT_PROJECT_VERSION is the
# Mac's build and is not reused here), so a re-run never collides.
#
# The .ipa is NOT attached to GitHub Releases: an App Store-signed .ipa cannot
# be installed outside TestFlight/the App Store, so a public `SureWord.ipa`
# asset would be a dead download. CLAUDE.md's fixed-asset invariant therefore
# carries no iOS asset until a distribution method exists that a user can
# actually install from a link.
#
# Austin-only steps stay Austin's: this never submits for review, never
# accepts agreements, and never releases a version.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_file="$script_dir/project.yml"
work_dir="$script_dir/build-ios-release.noindex"
bundle_id="com.spragginsdesigns.sureword"
share_bundle_id="com.spragginsdesigns.sureword.share"
team_id="389LLKGY3Y"
key_id="${ASC_KEY_ID:-7DQ48J77LB}"
issuer_id="${ASC_ISSUER_ID:-cba57450-1b28-47ea-9be9-98c9125afeab}"
key_path="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$key_id.p8}"

upload=1
for arg in "$@"; do
	case "$arg" in
	--no-upload) upload=0 ;;
	-h | --help) sed -n '2,24p' "$0"; exit 0 ;;
	*) printf 'release-ios: unknown argument %s\n' "$arg" >&2; exit 2 ;;
	esac
done

die() { printf 'release-ios: %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
asc() { uv run -q --with pyjwt --with cryptography --with requests python "$script_dir/scripts/asc.py" "$@"; }

command -v xcodegen >/dev/null 2>&1 || die "xcodegen is required (brew install xcodegen)"
command -v xcodebuild >/dev/null 2>&1 || die "xcodebuild is required"
command -v uv >/dev/null 2>&1 || die "uv is required (brew install uv)"
[ -f "$key_path" ] || die "App Store Connect key missing: $key_path"
security find-identity -v -p codesigning | grep -q "Apple Distribution: .*($team_id)" ||
	die "no Apple Distribution identity for team $team_id in the keychain"

version="$(sed -nE 's/^[[:space:]]*MARKETING_VERSION:[[:space:]]*"?([^"[:space:]]+)"?[[:space:]]*$/\1/p' "$project_file" | head -n 1)"
[ -n "$version" ] || die "MARKETING_VERSION is missing from $project_file"

step "Generating the Xcode project"
(cd -- "$script_dir" && xcodegen generate >/dev/null)

# The share extension ships only once its target exists in project.yml.
bundle_ids=("$bundle_id")
if grep -q "$share_bundle_id" "$project_file"; then bundle_ids+=("$share_bundle_id"); fi

step "Provisioning profiles (${bundle_ids[*]})"
profile_map="$(asc profiles "${bundle_ids[@]}")" || die "could not create or fetch App Store profiles"
printf '%s\n' "$profile_map"
profile_for() { printf '%s\n' "$profile_map" | awk -F'\t' -v id="$1" '$1 == id { print $2 }'; }

step "Build number for $version"
if build="$(asc next-build "$bundle_id" "$version")"; then
	:
elif [ "$upload" -eq 0 ]; then
	build="1"
	printf 'No App Store Connect app record yet; using build %s for a local export.\n' "$build"
else
	die "create the SureWord app record in App Store Connect first (My Apps -> + -> New App, bundle id $bundle_id)"
fi
printf 'SureWord %s (%s)\n' "$version" "$build"

rm -rf "$work_dir"
mkdir -p "$work_dir"
xcconfig="$work_dir/distribution.xcconfig"
{
	echo "CODE_SIGN_STYLE = Manual"
	echo "CODE_SIGN_IDENTITY = Apple Distribution"
	echo "DEVELOPMENT_TEAM = $team_id"
	echo "CURRENT_PROJECT_VERSION = $build"
	echo "SUREWORD_PROFILE_SureWord_iOS = $(profile_for "$bundle_id")"
	if [ "${#bundle_ids[@]}" -gt 1 ]; then
		# TARGET_NAME "SureWord-iOS-Share" as a c99 identifier (project.yml).
		echo "SUREWORD_PROFILE_SureWord_iOS_Share = $(profile_for "$share_bundle_id")"
	fi
	echo 'PROVISIONING_PROFILE_SPECIFIER = $(SUREWORD_PROFILE_$(TARGET_NAME:c99extidentifier))'
} >"$xcconfig"

step "Archiving"
archive="$work_dir/SureWord.xcarchive"
xcodebuild -project "$script_dir/SureWord.xcodeproj" -scheme SureWord-iOS -configuration Release \
	-destination 'generic/platform=iOS' -derivedDataPath "$work_dir/DerivedData" \
	-xcconfig "$xcconfig" -archivePath "$archive" archive >"$work_dir/archive.log" 2>&1 ||
	{ grep -E "error:|warning: .*[Pp]rivacy" "$work_dir/archive.log" | head -20 >&2; die "archive failed; see $work_dir/archive.log"; }
grep -E "warning: .*[Pp]rivacy" "$work_dir/archive.log" | head -5 || true

step "Exporting"
options="$work_dir/ExportOptions.plist"
{
	cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key><string>app-store-connect</string>
	<key>destination</key><string>$([ "$upload" -eq 1 ] && echo upload || echo export)</string>
	<key>teamID</key><string>$team_id</string>
	<key>signingStyle</key><string>manual</string>
	<key>signingCertificate</key><string>Apple Distribution</string>
	<key>uploadSymbols</key><true/>
	<key>manageAppVersionAndBuildNumber</key><false/>
	<key>provisioningProfiles</key>
	<dict>
EOF
	for id in "${bundle_ids[@]}"; do
		printf '\t\t<key>%s</key><string>%s</string>\n' "$id" "$(profile_for "$id")"
	done
	cat <<EOF
	</dict>
</dict>
</plist>
EOF
} >"$options"

xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$options" \
	-exportPath "$work_dir/export" \
	-authenticationKeyPath "$key_path" -authenticationKeyID "$key_id" -authenticationKeyIssuerID "$issuer_id" \
	>"$work_dir/export.log" 2>&1 ||
	{ grep -E "error" "$work_dir/export.log" | head -20 >&2; die "export failed; see $work_dir/export.log"; }

if [ "$upload" -eq 1 ]; then
	printf '\nUploaded SureWord %s (%s) to App Store Connect. It appears in TestFlight after processing (usually 5-30 minutes).\n' "$version" "$build"
else
	printf '\nExported %s\n' "$(ls "$work_dir"/export/*.ipa)"
fi

# The store text lives in store-listing/app-store.md and is easy to forget,
# because Apple locks it while a version is in review (the 2026-10-09 rename
# waited on 1.13.0). Every release reports drift; it never blocks the build and
# never writes, since the description must pass that doc's verify list first.
listing_doc="$script_dir/../store-listing/app-store.md"
if ! asc listing check "$bundle_id" "$listing_doc"; then
	printf 'release-ios: the App Store listing is behind %s.\n' "store-listing/app-store.md" >&2
	printf 'release-ios: after its verify list, run: uv run -q --with pyjwt --with cryptography --with requests python macos/scripts/asc.py listing apply %s store-listing/app-store.md\n' "$bundle_id" >&2
fi
