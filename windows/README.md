# SureWord for Windows

Phase 1 of the N5 plan item: SureWord on Windows is the web app
(`https://sureword.app`) packaged as an MSIX with [PWABuilder](https://www.pwabuilder.com)
and listed on the Microsoft Store. One codebase, full feature parity for free,
a Start-menu icon and a real window. Phase 2 (a Tauri native shell with a tray,
native notifications and a global hotkey) is only built if Phase 1 shows
demand — see "Not doing" in `docs/product-changes-review-2026-09-12.html`.

## What the app is

| Fact | Value |
|------|-------|
| App URL | `https://sureword.app` |
| Manifest | `public/site.webmanifest` (live at `/site.webmanifest`, linked from `src/app/layout.tsx`) |
| Display | `standalone`, `theme_color`/`background_color` `#0a0a0a` |
| Icons | `/icon-192.png`, `/icon-512.png` (`any`) + `/web-app-manifest-192x192.png`, `/web-app-manifest-512x512.png` (`maskable`) |
| Package family | `com.spragginsdesigns.sureword` (set in PWABuilder options, step 4 below) |

**Icons are never hand-drawn.** Every asset derives from the master via the
logo pipeline (see `CLAUDE.md` → Brand assets):

```bash
node scripts/generate-logo.mjs dawn        # only if the master changed
python scripts/apply-logo.py .logo-work/dawn.png
```

PWABuilder generates every MSIX asset size (44/50/150/310px tiles, Store
logos, splash) from the manifest's 512px maskable icon, so no extra art is
needed. If the maskable art ever changes, re-run `apply-logo.py`, deploy, and
rebuild the package — do not edit the generated tile PNGs.

## Build the MSIX (exact steps)

1. Confirm the live manifest scores clean:
   `curl -s https://sureword.app/site.webmanifest` — must contain `id`,
   `start_url`, `display: "standalone"`, `theme_color`, `background_color`,
   and 192/512 icons with both `any` and `maskable` purposes (it does today).
2. Open <https://www.pwabuilder.com>, enter `https://sureword.app`, run the
   report. The manifest section must be green. A service-worker warning is
   expected and non-blocking (see "Known gaps" below).
3. **Package For Stores → Windows → Store Package.** PWABuilder asks for the
   Partner Center identity values:
   - **Package ID / Identity name** — from Partner Center → your app →
     Product management → Product identity (e.g. `SpragginsDesigns.SureWord`).
     Until C8 creates that listing, use `com.spragginsdesigns.sureword` for a
     sideload test build.
   - **Publisher display name** — the Partner Center legal name.
   - **Publisher (DN)** — e.g. `CN=01234567-89AB-CDEF-0123-456789ABCDEF`,
     copied verbatim from Product identity. Wrong DN = Store rejects the upload.
   - **Version** — `1.0.0.0` first submission; bump the fourth digit per
     re-upload.
4. Download the package zip. It contains the `.msixbundle` (Store upload),
   a sideload `.msix`, and the generated image assets under
   `windows/store-assets/` if you choose to keep them in-repo (optional; they
   are reproducible from the manifest, so they are not committed).
5. Keep the downloaded zip out of git (binaries); record the PWABuilder
   report URL and the exact identity values used in the release notes for C8.

## Sideload test on a Windows 11 PC (no Store needed)

The Store package is unsigned until Microsoft signs it, so local testing uses
either the PWABuilder sideload build or the plain PWA install:

1. **PWA install (always works, today's proof path):** in Edge, open
   `https://sureword.app` → address-bar install icon (or ⋯ → Apps →
   "Install SureWord"). This creates the Start-menu entry, its own window,
   and an entry under Settings → Apps. Proof screenshots live in
   `artifacts/kimi-windows-pwa/`.
2. **Sideload MSIX (optional):** enable Developer Mode or sideloading in
   Settings → Privacy & security → For developers, then install the
   PWABuilder sideload `.msix` signed with a self-signed cert
   (`New-SelfSignedCertificate -Type Custom -Subject "CN=SureWord Test" -KeyUsage DigitalSignature -CertStoreLocation Cert:\CurrentUser\My`,
   then `signtool sign /fd SHA256 /a /sha1 <thumbprint> SureWord.msix` and
   install the cert into Trusted People first). Prefer the Store-signed
   package once C8 lands.

## Microsoft Store submission (C8, Stage 3)

1. Partner Center (partner.microsoft.com) → Create app → reserve the name
   **SureWord**. A developer account (~$19 one-time, individual) is required.
2. Copy the Product identity values into the PWABuilder options (step 3
   above) and rebuild the package so the identity matches the listing.
3. Upload the `.msixbundle`, fill the listing (description from
   `docs/play-store/` copy, category Books & reference, age 12+), add Store
   screenshots from `artifacts/` (desktop dark + light), submit for
   certification.
4. When live, the landing-page install card (Codex lane, N6) links the Store
   listing alongside the APK/DMG.

## Known gaps / open risks

- **No active service worker.** `public/sw.js` is a stale next-pwa artifact
  from an old build (its precache list references long-gone chunks) and
  nothing in `src/` registers it, so the site is installable but not
  offline-capable. PWABuilder ships the package regardless; offline support
  is a separate decision owned by the Fable lane (server/client split), not
  this lane.
- **Push notifications on Windows** ride on the web push decision, which the
  plan defers ("Not doing: web push"). The installed PWA gets no morning
  cross notification until that changes.
- **Phase 2 (Tauri)** adds tray/notifications/hotkey in `windows/` and is
  gated on Phase 1 usage evidence.
