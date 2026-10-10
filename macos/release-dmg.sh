#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
project_file="$script_dir/project.yml"
dmg_file="$script_dir/SureWord.dmg"
provenance_file="$dmg_file.provenance"
# The app inside the DMG must be signed by SureWord's Apple team under its own
# bundle id. The team also holds another company's app, so the pin is the
# bundle id plus the team, never the team alone.
team_id="389LLKGY3Y"
bundle_id="com.spragginsdesigns.sureword"
staging_dir=""
mount_dir=""

cleanup() {
	# Detach unconditionally: `mount` lists the image under /private/var/...
	# while mktemp returns /var/..., so a grep on `mount` never matched and a
	# failed check left the DMG attached. rmdir, never rm -rf, on a mountpoint.
	if [ -n "$mount_dir" ]; then
		hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 ||
			hdiutil detach "$mount_dir" -force -quiet >/dev/null 2>&1 || true
		rmdir "$mount_dir" 2>/dev/null || true
	fi
	[ -z "$staging_dir" ] || rm -rf "$staging_dir"
}
trap cleanup EXIT

die() {
	printf 'release-dmg: %s\n' "$*" >&2
	exit 1
}

command -v git >/dev/null 2>&1 || die "git is required"
command -v gh >/dev/null 2>&1 || die "gh is required"

[ -f "$project_file" ] || die "missing $project_file"
[ -s "$dmg_file" ] || die "missing or empty $dmg_file; build the DMG first"

version="$(sed -nE 's/^[[:space:]]*MARKETING_VERSION:[[:space:]]*"?([^"[:space:]]+)"?[[:space:]]*$/\1/p' "$project_file" | head -n 1)"
[ -n "$version" ] || die "MARKETING_VERSION is missing from $project_file"
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$' ||
	die "MARKETING_VERSION is not a release version: $version"

# Bind the DMG to the build that produced it and to the source on disk:
# build-dmg.sh records the DMG hash and a content digest of macos/, and a DMG
# with no record, a different hash, or source that changed since is refused.
# shellcheck source=../scripts/lib/release-provenance.sh
. "$repo_root/scripts/lib/release-provenance.sh"
[ -f "$provenance_file" ] ||
	die "missing $provenance_file; rebuild the DMG with scripts/build-dmg.sh (install-mac.sh --release does this)"
provenance_value() {
	awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$provenance_file"
}
[ "$(provenance_value dmgSha256)" = "$(release_sha256 "$dmg_file")" ] ||
	die "SureWord.dmg does not match the hash build-dmg.sh recorded; rebuild it"
[ "$(provenance_value version)" = "$version" ] ||
	die "SureWord.dmg was built as $(provenance_value version), but project.yml declares $version; rebuild it"
release_require_unchanged_source "$(provenance_value sourceSha256)" "$dmg_file.sources" "$repo_root" macos ||
	die "macos/ changed since SureWord.dmg was built; rebuild it"

command -v hdiutil >/dev/null 2>&1 || die "hdiutil is required to verify the DMG"
command -v codesign >/dev/null 2>&1 || die "codesign is required to verify the DMG"
[ -x /usr/libexec/PlistBuddy ] || die "PlistBuddy is required to verify the app version"
mount_dir="$(mktemp -d)"
hdiutil attach -nobrowse -readonly -mountpoint "$mount_dir" "$dmg_file" -quiet ||
	die "could not mount $dmg_file for version verification"
app_info="$mount_dir/SureWord.app/Contents/Info.plist"
[ -f "$app_info" ] || die "SureWord.app/Contents/Info.plist is missing from the DMG"
built_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_info")" ||
	die "could not read CFBundleShortVersionString from the DMG"
[ "$built_version" = "$version" ] ||
	die "DMG contains SureWord $built_version, but project.yml declares $version"
codesign --verify --deep --strict "$mount_dir/SureWord.app" ||
	die "SureWord.app in the DMG fails codesign --verify --deep --strict"
signature="$(codesign -dv "$mount_dir/SureWord.app" 2>&1)" ||
	die "could not read the code signature of SureWord.app in the DMG"
signed_team="$(printf '%s\n' "$signature" | sed -n 's/^TeamIdentifier=//p')"
signed_id="$(printf '%s\n' "$signature" | sed -n 's/^Identifier=//p')"
[ "$signed_team" = "$team_id" ] && [ "$signed_id" = "$bundle_id" ] ||
	die "SureWord.app in the DMG is signed as $signed_id by team ${signed_team:-none}, expected $bundle_id by team $team_id"
[ "$(release_app_cdhash "$mount_dir/SureWord.app")" = "$(provenance_value appCdhash)" ] ||
	die "SureWord.app in the DMG is not the app install-mac.sh built and recorded; rebuild with install-mac.sh --release"
hdiutil detach "$mount_dir" -quiet
rmdir "$mount_dir"
mount_dir=""

gh auth status >/dev/null 2>&1 || die "gh is not authenticated; run gh auth login first"

git -C "$repo_root" rev-parse --show-toplevel >/dev/null 2>&1 || die "not a git checkout: $repo_root"
git -C "$repo_root" remote get-url origin >/dev/null 2>&1 || die "git remote origin is missing"
repo="$(cd -- "$repo_root" && gh repo view --json nameWithOwner --jq .nameWithOwner)" ||
	die "could not resolve the GitHub repository"
[ -n "$repo" ] || die "GitHub repository name is empty"

staging_dir="$(mktemp -d)"

# `releases/latest/download/<asset>` is still used by persistent install links
# outside the welcome cards. Preserve the newest Android/iOS assets so making
# macOS the latest release cannot break another platform's download.
android_tag="$(cd -- "$repo_root" && gh release list --limit 100 \
	--json tagName,isDraft,isPrerelease,publishedAt \
	--jq '[.[] | select(.isDraft == false and .isPrerelease == false and (.tagName | startswith("android-v")))] | sort_by(.publishedAt) | last | .tagName // empty')"
[ -n "$android_tag" ] || die "no published Android release exists to preserve"
(cd -- "$repo_root" && gh release download "$android_tag" \
	--pattern 'SureWord.apk' --dir "$staging_dir" --clobber) ||
	die "could not preserve SureWord.apk from $android_tag"

ios_tag="$(cd -- "$repo_root" && gh release list --limit 100 \
	--json tagName,isDraft,isPrerelease,publishedAt \
	--jq '[.[] | select(.isDraft == false and .isPrerelease == false and (.tagName | startswith("ios-v")))] | sort_by(.publishedAt) | last | .tagName // empty')"
if [ -n "$ios_tag" ]; then
	(cd -- "$repo_root" && gh release download "$ios_tag" \
		--pattern 'SureWord.ipa' --dir "$staging_dir" --clobber) ||
		die "could not preserve SureWord.ipa from $ios_tag"
fi

assets=("$dmg_file#SureWord.dmg")
[ -f "$staging_dir/SureWord.apk" ] && assets+=("$staging_dir/SureWord.apk#SureWord.apk")
[ -f "$staging_dir/SureWord.ipa" ] && assets+=("$staging_dir/SureWord.ipa#SureWord.ipa")

tag="macos-v$version"
title="SureWord for macOS $version"
notes="SureWord for macOS $version. This build is distributed as an unsigned, unnotarized DMG. macOS may require Open Anyway in Privacy & Security on first launch."
commit="$(git -C "$repo_root" rev-parse HEAD)"

# The tag and release are deliberately mutable only when this script is run.
# Re-running the same command points the tag at the current commit and replaces
# the fixed-name DMG asset, making retries safe after an interrupted upload.
git -C "$repo_root" tag -f "$tag" "$commit" >/dev/null
git -C "$repo_root" push origin "refs/tags/$tag:refs/tags/$tag" --force

if (cd -- "$repo_root" && gh release view "$tag" >/dev/null 2>&1); then
	(cd -- "$repo_root" && gh release edit "$tag" --title "$title" --notes "$notes")
	(cd -- "$repo_root" && gh release upload "$tag" "${assets[@]}" --clobber)
else
	(cd -- "$repo_root" && gh release create "$tag" "${assets[@]}" --title "$title" --notes "$notes")
fi

printf 'Published %s (%s) with %s\n' "$tag" "$repo" "${assets[*]}"
printf 'DMG built from %s + %s uncommitted file(s) under macos/, app signed by team %s\n' \
	"$(provenance_value sourceCommit)" "$(provenance_value sourceDirtyFiles)" "$team_id"
