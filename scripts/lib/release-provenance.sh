# Signer and source checks shared by the native release scripts
# (mobile/scripts/build-aab.sh, push-phone.sh, release-apk.sh and
# scripts/build-dmg.sh, macos/install-mac.sh, macos/release-dmg.sh).
#
# Sourced, never executed. Kept to plain bash that runs in Git Bash on Windows
# and in bash on macOS.
#
# Why it exists: the publish steps used to trust whatever sat in the build
# output directory. A debug-signed or foreign-signed artifact, or a stale one
# built from different source, would have been uploaded to Play and GitHub as
# long as its version numbers lined up. Now every publish step proves:
#
#   1. the artifact is signed by the expected key (Android: the upload
#      certificate pinned in mobile/scripts/upload-cert.sha256; macOS: Apple
#      team 389LLKGY3Y), and
#   2. the source it was built from is still exactly the source on disk: the
#      build records a content digest of every tracked and untracked
#      (non-ignored) file in the platform directory, and the publish step
#      recomputes it. Files that cannot reach the binary are left out (see
#      release_source_listing), so a concurrent agent editing a test, a
#      fixture, a doc or a publish-only script during a build does not refuse
#      a good release. Everything that can be bundled or that feeds the
#      native, Gradle or Xcode build stays in.
#
# Builds from an uncommitted tree are still allowed (push-phone itself bumps
# app.json, and releases are routinely built before the commit that records
# them); the manifest records HEAD and the uncommitted file count so the
# publish log says exactly what was shipped.

release_sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$@" | awk '{print $1}'
	else
		shasum -a 256 "$@" | awk '{print $1}'
	fi
}

# release_source_listing <repo_root> <dir>
# Prints "<git blob id> <path>" for every tracked or untracked, non-ignored
# file under <dir> that can affect the built app, sorted by path. Left out:
#   - Markdown anywhere (CHANGELOG.md is edited between build and publish).
#   - mobile/: unit tests and fixtures under src/ (vitest only; Metro bundles
#     what the app imports, and nothing imports them), vitest.config.ts, and
#     the publish-only scripts (Play notes/upload/promote, release-apk.sh, the
#     certificate pin). mobile/app/ is never filtered: expo-router turns every
#     file there into a route. build-aab.sh and push-phone.sh stay in because
#     they patch the generated Gradle project.
#   - macos/: the *Tests and *UITests targets, macos/scripts/ (App Store
#     Connect and data generators; their outputs are tracked and stay in) and
#     the publish-only release-dmg.sh / release-ios.sh.
release_source_listing() {
	local root="$1" dir="$2" paths
	local -a excludes
	excludes=(":(exclude,glob)$dir/**/*.md")
	case "$dir" in
	mobile)
		excludes+=(
			":(exclude,glob)mobile/src/**/*.test.*"
			":(exclude,glob)mobile/src/**/__tests__/**"
			":(exclude,glob)mobile/src/**/__fixtures__/**"
			":(exclude)mobile/vitest.config.ts"
			":(exclude,glob)mobile/scripts/play-*.mjs"
			":(exclude)mobile/scripts/release-apk.sh"
			":(exclude)mobile/scripts/upload-cert.sha256"
		)
		;;
	macos)
		excludes+=(
			":(exclude,glob)macos/*Tests/**"
			":(exclude,glob)macos/scripts/**"
			":(exclude)macos/release-dmg.sh"
			":(exclude)macos/release-ios.sh"
		)
		;;
	esac
	paths="$(cd "$root" && git ls-files -z --cached --others --exclude-standard -- \
		"$dir" "${excludes[@]}" | tr '\0' '\n' |
		while IFS= read -r f; do
			if [ -f "$f" ]; then printf '%s\n' "$f"; fi
		done)" || return 1
	[ -n "$paths" ] || { echo "release-provenance: no source files under $dir" >&2; return 1; }
	printf '%s\n' "$paths" | (cd "$root" && git hash-object --stdin-paths) |
		paste -d ' ' - <(printf '%s\n' "$paths") | LC_ALL=C sort -k2
}

# release_source_digest <listing_file>
release_source_digest() {
	release_sha256 < "$1"
}

# release_source_dirty_count <repo_root> <dir>
release_source_dirty_count() {
	git -C "$1" status --porcelain -- "$2" | wc -l | tr -d ' '
}

# release_require_unchanged_source <recorded_digest> <recorded_listing> <repo_root> <dir>
# Fails, naming the changed files, when <dir> no longer matches what was built.
release_require_unchanged_source() {
	local recorded="$1" recorded_listing="$2" root="$3" dir="$4" current_listing current
	[ -n "$recorded" ] || {
		echo "release-provenance: the build recorded no source digest (built by an older script). Rebuild before publishing." >&2
		return 1
	}
	current_listing="$(mktemp)"
	release_source_listing "$root" "$dir" > "$current_listing" || { rm -f "$current_listing"; return 1; }
	current="$(release_source_digest "$current_listing")"
	if [ "$current" != "$recorded" ]; then
		echo "release-provenance: $dir changed since this artifact was built, so it no longer matches the source on disk." >&2
		if [ -f "$recorded_listing" ]; then
			echo "release-provenance: changed, added or removed since the build:" >&2
			diff "$recorded_listing" "$current_listing" | sed -n 's/^[<>] [0-9a-f]* /  /p' | LC_ALL=C sort -u >&2 || true
		fi
		echo "release-provenance: rebuild before publishing." >&2
		rm -f "$current_listing"
		return 1
	fi
	rm -f "$current_listing"
}

# ── macOS app build record ─────────────────────────────────────────────────
# install-mac.sh snapshots macos/ before xcodebuild and, once the build
# succeeds, records that snapshot next to the app ("<app>.sources" plus
# "<app>.build" holding the app's code-signature CDHash, HEAD and the
# uncommitted file count). build-dmg.sh packages only an app whose CDHash
# matches its record and whose recorded source still matches macos/, so a
# stale or replaced build-release.noindex app cannot be packaged later.

# release_app_cdhash <app>
release_app_cdhash() {
	codesign -dv --verbose=4 "$1" 2>&1 | sed -n 's/^CDHash=//p' | head -n 1
}

# release_record_app_build <app> <listing> <commit> <dirty_count>
release_record_app_build() {
	local app="$1" listing="$2" cdhash
	cdhash="$(release_app_cdhash "$app")"
	[ -n "$cdhash" ] || { echo "release-provenance: could not read the CDHash of $app" >&2; return 1; }
	cp "$listing" "$app.sources"
	printf 'cdhash=%s\nsourceCommit=%s\nsourceDirtyFiles=%s\nsourceSha256=%s\n' \
		"$cdhash" "$3" "$4" "$(release_source_digest "$listing")" > "$app.build"
}

# release_app_build_value <app> <key>
release_app_build_value() {
	awk -F= -v key="$2" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$1.build"
}

# release_require_app_build <app> <repo_root> <dir>
release_require_app_build() {
	local app="$1" root="$2" dir="$3"
	[ -f "$app.build" ] && [ -f "$app.sources" ] || {
		echo "release-provenance: $app has no build record, so nothing proves which source it was built from." >&2
		echo "release-provenance: build and package it with: bash macos/install-mac.sh --release" >&2
		return 1
	}
	[ "$(release_app_cdhash "$app")" = "$(release_app_build_value "$app" cdhash)" ] || {
		echo "release-provenance: $app is not the app its build record describes (rebuilt or replaced since)." >&2
		echo "release-provenance: rebuild and package it with: bash macos/install-mac.sh --release" >&2
		return 1
	}
	release_require_unchanged_source "$(release_app_build_value "$app" sourceSha256)" "$app.sources" "$root" "$dir" || {
		echo "release-provenance: rebuild and package it with: bash macos/install-mac.sh --release" >&2
		return 1
	}
}

# ── Android signing ────────────────────────────────────────────────────────

# release_java_tool <tool>: java, keytool or jarsigner from the first JDK found.
release_java_tool() {
	local tool="$1" home exe
	for home in "${SUREWORD_JAVA_HOME:-}" "${JAVA_HOME:-}" \
		/opt/homebrew/opt/openjdk@21 \
		"/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
		"C:/Program Files/Android/Android Studio/jbr"; do
		[ -n "$home" ] || continue
		home="${home//\\//}"
		for exe in "$home/bin/$tool" "$home/bin/$tool.exe"; do
			if [ -x "$exe" ]; then
				printf '%s\n' "$exe"
				return 0
			fi
		done
	done
	command -v "$tool" 2>/dev/null || { echo "release-provenance: $tool not found; set SUREWORD_JAVA_HOME to a JDK." >&2; return 1; }
}

release_apksigner_jar() {
	local sdk jar found=""
	case "$(uname -s)" in
	Darwin) sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}" ;;
	MINGW* | MSYS* | CYGWIN*) sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-${LOCALAPPDATA:-C:/Users/Owner/AppData/Local}/Android/Sdk}}" ;;
	*) sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}" ;;
	esac
	sdk="${sdk//\\//}"
	for jar in "$sdk"/build-tools/*/lib/apksigner.jar; do
		[ -f "$jar" ] && found="$jar"
	done
	[ -n "$found" ] || { echo "release-provenance: apksigner.jar not found under $sdk/build-tools; install Android SDK build-tools." >&2; return 1; }
	printf '%s\n' "$found"
}

# release_android_signers <apk|aab>: verifies the signature and prints the
# lowercase SHA-256 digest of every signing certificate, one per line.
release_android_signers() {
	local file="$1" out java jar keytool jarsigner
	case "$file" in
	*.apk)
		java="$(release_java_tool java)" || return 1
		jar="$(release_apksigner_jar)" || return 1
		out="$("$java" -jar "$jar" verify --print-certs "$file" 2>&1)" || {
			printf '%s\n' "$out" >&2
			echo "release-provenance: apksigner rejected $file" >&2
			return 1
		}
		printf '%s\n' "$out" | sed -nE 's/.*certificate SHA-256 digest: ([0-9a-fA-F]{64}).*/\1/p' |
			tr 'A-F' 'a-f' | LC_ALL=C sort -u
		;;
	*.aab)
		jarsigner="$(release_java_tool jarsigner)" || return 1
		keytool="$(release_java_tool keytool)" || return 1
		out="$("$jarsigner" -verify "$file" 2>&1)" || {
			printf '%s\n' "$out" | tail -5 >&2
			echo "release-provenance: jarsigner rejected $file" >&2
			return 1
		}
		# Java ends lines with CRLF on Windows. Here-strings rather than pipes
		# into grep -q: an early grep exit would SIGPIPE the writer and fail
		# the pipeline under the callers' pipefail.
		out="$(tr -d '\r' <<<"$out")"
		grep -qx 'jar verified\.' <<<"$out" || {
			echo "release-provenance: $file is not signed (jarsigner did not report 'jar verified.')." >&2
			return 1
		}
		if grep -q 'unsigned entries' <<<"$out"; then
			echo "release-provenance: $file contains unsigned entries." >&2
			return 1
		fi
		"$keytool" -printcert -jarfile "$file" 2>/dev/null |
			sed -nE 's/^[[:space:]]*SHA256: ([0-9A-Fa-f:]{95})[[:space:]]*$/\1/p' |
			tr -d ':' | tr 'A-F' 'a-f' | LC_ALL=C sort -u
		;;
	*)
		echo "release-provenance: unknown artifact type: $file" >&2
		return 1
		;;
	esac
}

# release_require_android_signer <apk|aab> <expected_file>
# Every signing certificate must be listed in <expected_file> (one SHA-256 per
# line, colons optional, # comments allowed).
release_require_android_signer() {
	local file="$1" expected_file="$2" expected signers digest
	[ -f "$expected_file" ] || {
		echo "release-provenance: missing $expected_file (the pinned upload certificate)." >&2
		return 1
	}
	expected="$(sed -e 's/#.*//' -e 's/[[:space:]:]//g' "$expected_file" | tr 'A-F' 'a-f' | grep -E '^[0-9a-f]{64}$' || true)"
	[ -n "$expected" ] || {
		echo "release-provenance: $expected_file lists no SHA-256 certificate digest." >&2
		return 1
	}
	signers="$(release_android_signers "$file")" || return 1
	[ -n "$signers" ] || {
		echo "release-provenance: no signing certificate found in $file" >&2
		return 1
	}
	for digest in $signers; do
		grep -qx "$digest" <<<"$expected" || {
			echo "release-provenance: $file is signed by certificate $digest, which is not the pinned upload certificate in $expected_file." >&2
			echo "release-provenance: refusing to publish. A debug or foreign key signed this build; check ~/.gradle/gradle.properties SUREWORD_UPLOAD_* and rebuild." >&2
			return 1
		}
	done
	printf '%s\n' "$signers"
}
