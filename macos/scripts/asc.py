"""App Store Connect helper for macos/release-ios.sh.

Talks to the App Store Connect API with the LineCrush Inc team key (SureWord is
published under LineCrush Inc; see docs/ios/PROGRESS.md decision (a)). The key
itself never enters the repo: it is read from ~/.appstoreconnect/private_keys.

  uv run --with pyjwt --with cryptography --with requests python macos/scripts/asc.py profiles \
      com.spragginsdesigns.sureword [com.spragginsdesigns.sureword.share ...]
      -> creates (or reuses) an IOS_APP_STORE profile per bundle id for the
         Apple Distribution certificate in this Mac's keychain, installs each
         into Xcode's profile directory, prints "<bundle id>\t<profile name>"
  ... asc.py next-build com.spragginsdesigns.sureword 1.10.0
      -> prints the next unused build number for that version (1 if the app
         has no builds yet); exits 3 when the App Store Connect app record
         does not exist (Apple's API cannot create it; Austin does, once)
  ... asc.py listing check|apply com.spragginsdesigns.sureword store-listing/app-store.md
      -> compares the en-US name, subtitle, promotional text, description and
         keywords in App Store Connect with that doc (the source of truth).
         `check` only reports and exits 4 on drift; `apply` writes the doc's
         text to the newest version and app info Apple still lets us edit, and
         exits 5 when everything is locked in review (try again afterwards).

Override the key with ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH.
"""
import base64
import os
import subprocess
import sys
import time
from pathlib import Path

import jwt
import requests

KEY_ID = os.environ.get("ASC_KEY_ID", "7DQ48J77LB")
ISSUER = os.environ.get("ASC_ISSUER_ID", "cba57450-1b28-47ea-9be9-98c9125afeab")
KEY_PATH = Path(os.environ.get("ASC_KEY_PATH", f"~/.appstoreconnect/private_keys/AuthKey_{KEY_ID}.p8")).expanduser()
BASE = "https://api.appstoreconnect.apple.com"
# Xcode 16+ reads profiles from here; older Xcode used ~/Library/MobileDevice.
PROFILE_DIRS = [
    Path("~/Library/Developer/Xcode/UserData/Provisioning Profiles").expanduser(),
    Path("~/Library/MobileDevice/Provisioning Profiles").expanduser(),
]


def headers():
    token = jwt.encode(
        {"iss": ISSUER, "aud": "appstoreconnect-v1", "exp": int(time.time()) + 900},
        KEY_PATH.read_text(),
        algorithm="ES256",
        headers={"kid": KEY_ID},
    )
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def get(path, **params):
    r = requests.get(BASE + path, headers=headers(), params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def post(path, body):
    r = requests.post(BASE + path, headers=headers(), json=body, timeout=60)
    if r.status_code >= 400:
        sys.exit(f"asc: POST {path} -> {r.status_code}: {r.text[:500]}")
    return r.json()


def keychain_distribution_serials():
    """Serial numbers of the Apple Distribution certs this Mac can sign with."""
    out = subprocess.run(
        ["security", "find-certificate", "-a", "-c", "Apple Distribution", "-p"],
        capture_output=True, text=True, check=False,
    ).stdout
    serials = set()
    for pem in out.split("-----END CERTIFICATE-----"):
        if "BEGIN CERTIFICATE" not in pem:
            continue
        pem += "-----END CERTIFICATE-----\n"
        res = subprocess.run(["openssl", "x509", "-noout", "-serial"], input=pem,
                             capture_output=True, text=True, check=False)
        if res.returncode == 0:
            serials.add(res.stdout.strip().split("=", 1)[1].upper().lstrip("0"))
    return serials


def distribution_certificate_id():
    serials = keychain_distribution_serials()
    certs = get("/v1/certificates", **{"filter[certificateType]": "DISTRIBUTION", "limit": 50})["data"]
    for cert in certs:
        if cert["attributes"]["serialNumber"].upper().lstrip("0") in serials:
            return cert["id"]
    sys.exit("asc: no Apple Distribution certificate in this keychain matches App Store Connect")


def bundle_id_resource(identifier):
    data = get("/v1/bundleIds", **{"filter[identifier]": identifier, "limit": 5})["data"]
    match = [d for d in data if d["attributes"]["identifier"] == identifier]
    if not match:
        sys.exit(f"asc: bundle id {identifier} is not registered")
    return match[0]["id"]


def install(profile):
    attrs = profile["attributes"]
    content = base64.b64decode(attrs["profileContent"])
    for d in PROFILE_DIRS:
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{attrs['uuid']}.mobileprovision").write_bytes(content)


def profiles(identifiers):
    cert = distribution_certificate_id()
    for identifier in identifiers:
        name = f"SureWord {identifier} App Store"
        bid = bundle_id_resource(identifier)
        existing = get("/v1/profiles", **{"filter[name]": name, "limit": 10})
        # Always regenerate: a profile freezes the App ID's capabilities and app
        # groups at creation, so one made before the App Group was assigned
        # (or before Sign in with Apple was enabled) would sign an archive that
        # App Store Connect rejects. Only profiles carrying this exact
        # SureWord name are ever deleted.
        for p in existing["data"]:
            if p["attributes"]["name"] == name:
                requests.delete(f"{BASE}/v1/profiles/{p['id']}", headers=headers(), timeout=60)
        profile = post("/v1/profiles", {"data": {
            "type": "profiles",
            "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
            "relationships": {
                "bundleId": {"data": {"type": "bundleIds", "id": bid}},
                "certificates": {"data": [{"type": "certificates", "id": cert}]},
            },
        }})["data"]
        install(profile)
        print(f"{identifier}\t{name}")


def next_build(identifier, version):
    apps = get("/v1/apps", **{"filter[bundleId]": identifier, "limit": 5})["data"]
    if not apps:
        print(f"asc: no App Store Connect app record for {identifier}", file=sys.stderr)
        sys.exit(3)
    builds = get("/v1/builds", **{
        "filter[app]": apps[0]["id"], "filter[preReleaseVersion.version]": version,
        "sort": "-uploadedDate", "limit": 50,
    })["data"]
    numbers = [int(b["attributes"]["version"]) for b in builds if b["attributes"]["version"].isdigit()]
    print(max(numbers, default=0) + 1)


# Apple only accepts listing edits in these states; anything else (waiting for
# review, in review, ready for sale) is locked until the next version.
EDITABLE_STATES = {
    "PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED",
    "METADATA_REJECTED", "INVALID_BINARY",
}


def listing_from_doc(path):
    """Name, subtitle and the fenced text blocks from store-listing/app-store.md."""
    import re
    text = Path(path).read_text(encoding="utf-8").replace("\r\n", "\n")

    def row(field):
        m = re.search(rf"^\| {field} \| `([^`]+)` \|", text, re.M)
        if not m:
            sys.exit(f"asc: no `{field}` row in {path}")
        return m.group(1)

    def block(heading):
        m = re.search(rf"^## {re.escape(heading)}[^\n]*\n.*?^```\n(.*?)\n```", text, re.M | re.S)
        if not m:
            sys.exit(f"asc: no fenced block under '## {heading}' in {path}")
        return m.group(1)

    return {
        "name": row("Name"),
        "subtitle": row("Subtitle"),
        "promotionalText": block("Promotional text"),
        "description": block("Description"),
        "keywords": block("Keywords"),
    }


def listing(mode, identifier, doc):
    want = listing_from_doc(doc)
    app = get("/v1/apps", **{"filter[bundleId]": identifier, "limit": 5})["data"][0]["id"]

    def newest(items, state_key):
        # Prefer one Apple still lets us edit; otherwise the newest, read-only.
        if not items:
            sys.exit(f"asc: {identifier} has no App Store records to compare")
        editable = [i for i in items if i["attributes"].get(state_key) in EDITABLE_STATES]
        return (editable or items)[0]

    infos = get(f"/v1/apps/{app}/appInfos")["data"]
    versions = get(f"/v1/apps/{app}/appStoreVersions", **{"filter[platform]": "IOS", "limit": 10})["data"]
    info = newest(infos, "appStoreState")
    version = newest(versions, "appStoreState")
    targets = [
        (info, f"/v1/appInfos/{info['id']}/appInfoLocalizations", "appInfoLocalizations", ["name", "subtitle"]),
        (version, f"/v1/appStoreVersions/{version['id']}/appStoreVersionLocalizations",
         "appStoreVersionLocalizations", ["promotionalText", "description", "keywords"]),
    ]
    drift, locked = [], []
    for owner, path, kind, fields in targets:
        state = owner["attributes"].get("appStoreState")
        label = owner["attributes"].get("versionString", "app info")
        loc = next(l for l in get(path)["data"] if l["attributes"]["locale"] == "en-US")
        changed = {f: want[f] for f in fields if (loc["attributes"].get(f) or "") != want[f]}
        for f in changed:
            drift.append(f"{f} ({label}, {state})")
        if not changed or mode != "apply":
            continue
        if state not in EDITABLE_STATES:
            locked.append(f"{label} is {state}")
            continue
        r = requests.patch(f"{BASE}/v1/{kind}/{loc['id']}", headers=headers(), timeout=60,
                           json={"data": {"type": kind, "id": loc["id"], "attributes": changed}})
        if r.status_code >= 400:
            sys.exit(f"asc: PATCH {kind} -> {r.status_code}: {r.text[:500]}")
        print(f"asc: wrote {', '.join(changed)} to {label}")
    if mode == "check":
        if drift:
            print("asc: App Store listing differs from " + doc + ": " + "; ".join(drift))
            sys.exit(4)
        print("asc: App Store listing matches " + doc)
    elif locked:
        print("asc: locked while " + "; ".join(locked) + ". Run `listing apply` again once review finishes.")
        sys.exit(5)


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "profiles":
        profiles(sys.argv[2:])
    elif len(sys.argv) == 4 and sys.argv[1] == "next-build":
        next_build(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 5 and sys.argv[1] == "listing" and sys.argv[2] in ("check", "apply"):
        listing(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        sys.exit(__doc__)
