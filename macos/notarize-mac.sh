#!/usr/bin/env bash
# Notarize the recorded Release app, then build/sign/notarize its DMG.
#   bash macos/notarize-mac.sh
# This deliberately does not publish. release-dmg.sh sources the verification
# functions below, then checks the final artifact again before any GitHub write.

sureword_notary_error() { printf 'notarize-mac: %s\n' "$*" >&2; return 1; }

sureword_verify_developer_id() {
	local signature="$1" expected_id="$2"
	grep -Fxq 'TeamIdentifier=389LLKGY3Y' <<<"$signature" &&
		grep -Fxq "Identifier=$expected_id" <<<"$signature" &&
		grep -q '^Authority=Developer ID Application:' <<<"$signature" &&
		grep -q '^Timestamp=' <<<"$signature" ||
		sureword_notary_error "$expected_id needs the SureWord Developer ID signature and a secure timestamp"
}

sureword_verify_distribution_app() {
	local app="$1" require_ticket="${2:-yes}" code expected_id executable architectures arch signature entitlements
	codesign --verify --deep --strict --all-architectures "$app" || return 1
	for code in "$app" "$app/Contents/PlugIns/SureWordShare.appex"; do
		[ -d "$code" ] || { sureword_notary_error "missing app or Share extension"; return 1; }
		expected_id=com.spragginsdesigns.sureword
		[ "$code" = "$app" ] || expected_id="$expected_id.share"
		executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$code/Contents/Info.plist")" || return 1
		architectures="$(lipo -archs "$code/Contents/MacOS/$executable")" || return 1
		[ -n "$architectures" ] || return 1
		for arch in $architectures; do
			signature="$(codesign -dv --verbose=4 --arch "$arch" "$code" 2>&1)" || return 1
			sureword_verify_developer_id "$signature" "$expected_id" || return 1
			grep -Eq '^CodeDirectory .*flags=.*\([^)]*runtime[^)]*\)' <<<"$signature" ||
				{ sureword_notary_error "$expected_id ($arch) lacks Hardened Runtime"; return 1; }
			entitlements="$(codesign -d --arch "$arch" --entitlements :- "$code" 2>/dev/null)" || return 1
			python3 -c '
import plistlib, sys
e = plistlib.loads(sys.stdin.buffer.read())
host = sys.argv[1] == "com.spragginsdesigns.sureword"
group = "389LLKGY3Y.group.com.spragginsdesigns.sureword"
valid = "com.apple.security.get-task-allow" not in e and group in e.get("com.apple.security.application-groups", [])
if host:
    valid = valid and e.get("com.apple.developer.aps-environment") == "production"
    valid = valid and e.get("com.apple.application-identifier") == "389LLKGY3Y.com.spragginsdesigns.sureword"
    valid = valid and e.get("com.apple.developer.team-identifier") == "389LLKGY3Y"
    valid = valid and e.get("com.apple.security.personal-information.calendars") is True
else:
    valid = valid and e.get("com.apple.security.app-sandbox") is True
if not valid:
    sys.exit("Release entitlements must retain production push/App Group/calendar or Share sandbox, with no get-task-allow")
' "$expected_id" <<<"$entitlements" || return 1
		done
	done
	if [ "$require_ticket" = yes ]; then
		xcrun stapler validate "$app" || return 1
		spctl --assess --type execute --verbose=2 "$app" || return 1
	fi
}

sureword_verify_distribution_dmg() {
	local dmg="$1" signature
	hdiutil verify "$dmg" || return 1
	codesign --verify --strict "$dmg" || return 1
	signature="$(codesign -dv --verbose=4 "$dmg" 2>&1)" || return 1
	sureword_verify_developer_id "$signature" com.spragginsdesigns.sureword.dmg || return 1
	xcrun stapler validate "$dmg" || return 1
	spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg" || return 1
}

sureword_notary_main() (
	set -euo pipefail
	umask 077
	[ "$#" = 0 ] || { sureword_notary_error 'usage: bash macos/notarize-mac.sh'; exit 2; }
	local script_dir repo_root app dmg evidence work_dir credentials asc_key_id asc_issuer_id asc_key_path
	local app_submission dmg_submission original_hash original_cdhash provenance_tmp
	script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
	repo_root="$(cd -- "$script_dir/.." && pwd)"
	app="$script_dir/build-release.noindex/Build/Products/Release/SureWord.app"
	dmg="$script_dir/SureWord.dmg"
	for tool in python3 codesign lipo xcrun spctl hdiutil uv; do
		command -v "$tool" >/dev/null 2>&1 || { sureword_notary_error "$tool is required"; exit 1; }
	done
	# shellcheck source=../scripts/lib/release-provenance.sh
	. "$repo_root/scripts/lib/release-provenance.sh"
	release_require_app_build "$app" "$repo_root" macos
	sureword_verify_distribution_app "$app" no
	original_cdhash="$(release_app_build_value "$app" cdhash)"
	# Resolve only asc.py's existing key metadata, without importing its API
	# helpers, reading private key contents, or copying credentials into a file.
	credentials="$(python3 - "$script_dir/scripts/asc.py" <<'PY'
import ast, os, sys
from pathlib import Path
tree = ast.parse(Path(sys.argv[1]).read_text())
def default(name):
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value.args[1])
    raise ValueError("ASC key metadata is unavailable; set ASC_KEY_ID and ASC_ISSUER_ID")
kid = os.environ.get("ASC_KEY_ID") or default("KEY_ID")
issuer = os.environ.get("ASC_ISSUER_ID") or default("ISSUER")
key = str(Path(os.environ.get("ASC_KEY_PATH") or f"~/.appstoreconnect/private_keys/AuthKey_{kid}.p8").expanduser())
if any("\n" in value or "\t" in value for value in (kid, issuer, key)):
    sys.exit("Invalid ASC key metadata")
print("\t".join((kid, issuer, key)))
PY
)"
	IFS=$'\t' read -r asc_key_id asc_issuer_id asc_key_path <<<"$credentials"
	[ -r "$asc_key_path" ] || { sureword_notary_error 'existing ASC private key is not readable'; exit 1; }
	mkdir -p "$script_dir/build-release.noindex/notarization"
	evidence="$(mktemp -d "$script_dir/build-release.noindex/notarization/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
	work_dir="$(mktemp -d)"
	provenance_tmp=""
	trap 'rm -rf "$work_dir"; [ -z "$provenance_tmp" ] || rm -f "$provenance_tmp"' EXIT

	submit() {
		local file="$1" label="$2" submission
		xcrun notarytool submit "$file" --key "$asc_key_path" --key-id "$asc_key_id" --issuer "$asc_issuer_id" \
			--wait --timeout "${SUREWORD_NOTARY_TIMEOUT:-30m}" --output-format json >"$evidence/$label-submit.json" || return 1
		submission="$(python3 - "$evidence/$label-submit.json" <<'PY'
import json, re, sys
result = json.load(open(sys.argv[1]))
if result.get("status") != "Accepted" or not re.fullmatch(r"[0-9a-fA-F-]{36}", result.get("id", "")):
    sys.exit("Notarization was not Accepted; inspect the saved submission response")
print(result["id"])
PY
)" || return 1
		xcrun notarytool log "$submission" --key "$asc_key_path" --key-id "$asc_key_id" --issuer "$asc_issuer_id" \
			"$evidence/$label-log.json" >&2 || return 1
		python3 - "$evidence/$label-log.json" "$submission" <<'PY' || return 1
import json, sys
result = json.load(open(sys.argv[1]))
issues = result.get("issues") or []
if result.get("status") != "Accepted" or str(result.get("jobId", "")).lower() != sys.argv[2].lower() or any(i.get("severity") == "error" for i in issues):
    sys.exit("Notarization log does not confirm the accepted submission")
print(f"Notarization log verified; {len(issues)} issue(s), see {sys.argv[1]}", file=sys.stderr)
PY
		printf '%s\n' "$submission"
	}

	printf 'Notarizing the recorded Release app; evidence: %s\n' "$evidence"
	ditto -c -k --keepParent "$app" "$work_dir/SureWord.zip"
	app_submission="$(submit "$work_dir/SureWord.zip" app)"
	xcrun stapler staple "$app"
	sureword_verify_distribution_app "$app"
	# Stapling must not substitute a new app or change the source identity.
	release_require_app_build "$app" "$repo_root" macos
	[ "$(release_app_cdhash "$app")" = "$original_cdhash" ]
	SUREWORD_DMG_BACKEND=headless bash "$repo_root/scripts/build-dmg.sh" "$app" "$dmg"
	original_hash="$(release_sha256 "$dmg")"
	[ "$(awk -F= '$1 == "dmgSha256" {print $2}' "$dmg.provenance")" = "$original_hash" ]
	[ "$(awk -F= '$1 == "appCdhash" {print $2}' "$dmg.provenance")" = "$original_cdhash" ]
	codesign --sign "${SUREWORD_MAC_PUSH_IDENTITY:-Developer ID Application: LineCrush Inc (389LLKGY3Y)}" \
		--identifier com.spragginsdesigns.sureword.dmg --timestamp "$dmg"
	dmg_submission="$(submit "$dmg" dmg)"
	xcrun stapler staple "$dmg"
	sureword_verify_distribution_dmg "$dmg"
	release_require_app_build "$app" "$repo_root" macos
	[ "$(release_app_cdhash "$app")" = "$original_cdhash" ]
	# Only container signing/stapling changed the DMG bytes. Retain the original
	# source/app record, and atomically replace its hash after all final checks.
	provenance_tmp="$(mktemp "$dmg.provenance.XXXXXX")"
	awk -F= -v digest="$(release_sha256 "$dmg")" -v app_id="$app_submission" -v dmg_id="$dmg_submission" '
		$1 == "dmgSha256" { print "dmgSha256=" digest; next }
		$1 == "notarized" { next }
		{ print }
		END { print "notarized=true"; print "appNotarySubmission=" app_id; print "dmgNotarySubmission=" dmg_id }
	' "$dmg.provenance" >"$provenance_tmp"
	mv "$provenance_tmp" "$dmg.provenance"
	provenance_tmp=""
	printf 'Signed, notarized and stapled %s. Nothing published.\nNext: bash macos/release-dmg.sh\n' "$dmg"
)

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	sureword_notary_main "$@"
fi
