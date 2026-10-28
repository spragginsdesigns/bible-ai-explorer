# Creator credit, 2026-10-28

Source revision: `368fc2b24aa82f0961ec9ac6f225c4e23cc29e56`.

The web, Android, macOS and iOS composer sources use the approved wording:
"Created by Austin Spraggins, a follower of Jesus Christ." Only Austin's
name links to `https://www.spragginsdesigns.xyz/#faith`. The web retains its
existing AI discernment note on the line above the credit.

## Web

Production deployment `dpl_EFtztVYbTXu1tj96gumfmGSPD5EW` reached READY for
the exact source revision and was assigned `sureword.app`. A public GET of
`/_next/static/chunks/app/page-569995a251ef13a1.js` contains the exact credit
and faith URL.

The public homepage is the marketing page, so an isolated browser without
an account does not show the authenticated composer. No account session was
extracted or fabricated. The shipping disclaimer JSX was rendered with the
production CSS at widths 1440, 390 and 320 and text scales 1 and 1.3.
All six checks passed exact wording, destination, keyboard focus and no
horizontal overflow. This supports wrapping and link styling, not a claim
of signed-in full-product runtime acceptance.

## Android

Version `1.109.0`, versionCode `128`. A clean git archive was initialized
against the source revision for release provenance, excluding every
concurrent uncommitted integration edit. Fresh `npm ci` and `npm run
typecheck` passed in that archive. The shared checkout's existing dependency
tree lacked `expo-speech`; no shared dependencies were changed.

The first all-ABI release build failed with a JVM native-allocation OOM
(`hs_err_pid69884.log`). Only the isolated, ignored generated Gradle config
was adjusted for the retry: two workers and parallel builds disabled. A
requested 2 GB heap and `HeapBaseMinAddress=32g` were overwritten by
`build-aab.sh`, which pins a 4 GB heap and 1 GB metaspace on every invocation.
The completed generated config was inspected to correct this distinction;
the run must not be described as using a 2 GB heap. Source files and machine
settings were unchanged. That retry passed Java/resource/DEX work, then failed after
10m54s at `:app:buildCMakeRelWithDebInfo[arm64-v8a]`, Ninja step 50/104.
The NDK 27.1 Clang 18.0.2 diagnostics explicitly say `LLVM ERROR: out of
memory` and `Allocation failed`, followed by exception `0xC000001D`.
Diagnostic reproductions include
`%LOCALAPPDATA%/Temp/RNSVGImageState-589157.cpp` and its `.sh` twin,
`rnscreens-84ea23.cpp` and `.sh`, `ShadowNodes-1e1c2f.cpp` and `.sh`, and
`RNSVGImageShadowNode-eaa758.cpp` and `.sh` in the same directory.

The failing Ninja command had no `-j` argument, and `ninja --help` reports
14 parallel jobs by default on this machine. The generated Ninja file had
no compile pool, so the Gradle worker limit had not bounded native jobs.
A targeted recovery attempt adds compile and link pools of depth one only
to the isolated archive's ignored React Native CMake setup. No machine,
SDK, global Gradle or canonical application source setting was changed.
The regenerated `rules.ninja` proved compile and link pools at depth one.
The process chain was wrapper 60836, daemon 31260, Ninja 47420 and one
Clang child, all belonging to this archive. A CPU sample showed the compiler
actively working and no descendants from the failed attempts remaining.
Arm64 progress reached 74 completed native entries by 12:27:31 Pacific.

Read-only host snapshots reported 95-96% commit usage, approximately
84-85 GB against an 88.28 GB limit. The final bounded run was stopped at
the lead's resource gate to avoid competing with other sessions. A graceful
`taskkill /PID 60836 /T` was refused for console children; only the verified
owned descendant PIDs were then terminated. All archive files and completed
native objects were preserved. The emulator claim was removed, and
`adb -s emulator-5554 get-state` still returned `device`. The emulator was
left running and its installed app/session was not changed.

No final `.so`, signed APK/AAB pair, emulator install, keyboard/large-text
acceptance, Play upload or GitHub release is claimed for 1.109.0 (128).
Fresh Publisher readback at `2026-10-28T19:28:29.399Z` showed both internal
and alpha tracks at 1.108.1, versionCode 127, status `completed`.
TickTick follow-up: `6ae24c9e8f0871a7dbf02efa`.

### Safe Android resume

Before resuming, inspect current `main`, release ownership, both Play tracks,
GitHub Releases and `/api/native-releases`. If a newer binary already carries
this credit, verify that release and close the follow-up. If newer unrelated
work exists, integrate the credit into the current release source rather
than publish this older archive over it. The 127 track readback and unused
128 versionCode are dated evidence from this run, not ongoing permission to
reuse 128. Recheck the current version and changelog contract before publishing.

Resume only when the host has capacity for the script's 4 GB Java heap and
one native compiler. The archive's ignored generated Gradle properties now
retain one worker and parallel disabled. Its ignored React Native default CMake setup retains
compile/link job pools of one. Do not run a new prebuild that replaces these
local resource limits. This archive is the retained build evidence for 128;
the live checks above decide whether it remains the appropriate release input.

Run in Git Bash:

```bash
cd /c/Users/Owner/AppData/Local/Temp/sureword-credit-368fc2b2
export JAVA_HOME="C:/Users/Owner/.gradle/jdks/eclipse_adoptium-21-amd64-windows.2"
export SUREWORD_JAVA_HOME="$JAVA_HOME"
export CMAKE_BUILD_PARALLEL_LEVEL=1
bash mobile/scripts/build-aab.sh
```

Check that regenerated `rules.ninja` still has `sureword_compile` and
`sureword_link` pools with `depth = 1`. After a successful signed build,
verify the artifact manifest binds both files to source `368fc2b2`,
version 1.109.0, code 128 and the pinned upload signer. Claim the shared
emulator before installation, preserve its existing app data, and verify
the creator credit with the keyboard open and large system text. The local
proof script is `%LOCALAPPDATA%/Temp/sureword-credit-android-proof.py`.
Only after product acceptance:

```bash
bash mobile/scripts/push-phone.sh --skip-build
```

Read back both Publisher tracks, GitHub asset digests, fixed APK/DMG links
and the native-releases API. This last command still has not run.

## Apple

Version `1.29.0`, build `38`, from the same clean archive on the Mac.
The iOS Simulator build passed with `CODE_SIGNING_ALLOWED=NO`.
The macOS Release build compiled but CodeSign failed with
`errSecInternalComponent`. Repeating that cached Release build with
`CODE_SIGNING_ALLOWED=NO` passed. Both logs report `BUILD SUCCEEDED` for
their unsigned build paths. No Apple runtime acceptance is claimed.

The primary Mac checkout is owned by another active Codex session, based
at `54213ccc`, with substantial unpublished Apple parity work. That session
installed its own `1.29.0 (38)` during this run. This lane's installer was
paused before shared installation and then terminated. It did not replace
`/Applications/SureWord.app`, publish a DMG or upload to TestFlight.

Apple distribution therefore remains blocked by both the signing boundary
and simultaneous release ownership/version collision. Reconcile that
session's final source and release version before a combined Apple release.
TickTick follow-up: `6ae247e68f08903670065d07`.

## Local evidence

Windows release archive:
`%LOCALAPPDATA%/Temp/sureword-credit-368fc2b2`.
Viewport screenshots and measurements:
`%LOCALAPPDATA%/Temp/sureword-credit-proof/`.
Android logs:
`%LOCALAPPDATA%/Temp/sureword-credit-android.log` and
`%LOCALAPPDATA%/Temp/sureword-credit-android-retry.log`, plus
`%LOCALAPPDATA%/Temp/sureword-credit-android-native-capped.log`.

Mac archive: `~/sureword-credit-368fc2b2.noindex`.
Apple logs: `/tmp/sureword-credit-mac.log`,
`/tmp/sureword-credit-mac-unsigned.log`, `/tmp/sureword-credit-ios.log`.
