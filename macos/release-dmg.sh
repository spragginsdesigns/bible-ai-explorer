#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
project_file="$script_dir/project.yml"
dmg_file="$script_dir/SureWord.dmg"
staging_dir=""
mount_dir=""

cleanup() {
	if [ -n "$mount_dir" ] && mount | grep -Fq " on $mount_dir "; then
		hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 || true
	fi
	[ -z "$mount_dir" ] || rm -rf "$mount_dir"
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

command -v hdiutil >/dev/null 2>&1 || die "hdiutil is required to verify the DMG"
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
