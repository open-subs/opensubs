#!/usr/bin/env python3
"""App Store Connect, from the command line: the signing assets an archive needs.

Xcode's own answer to "no signing identity" is Settings → Accounts → Manage
Certificates → +, which is a person clicking in a GUI on one particular Mac.
Everything it does there is in the App Store Connect API, and this does it
with the API key already on this machine: an Apple Distribution certificate
whose private key stays here, the App ID, and the App Store provisioning
profile that ties them together.

    export ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=<uuid-from-the-keys-page>
    ./scripts/asc.py whoami          # does the key work, and for whom
    ./scripts/asc.py ensure-cert     # Apple Distribution cert + key, in the keychain
    ./scripts/asc.py ensure-app-id   # the bundle id, with In-App Purchase
    ./scripts/asc.py ensure-profile  # the App Store profile, installed
    ./scripts/asc.py setup           # all three, in order
    ./scripts/asc.py ensure-iaps     # the consumables, worded and priced
    ./scripts/asc.py show-iaps       # what App Store Connect holds now

The .p8 is read from ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8,
where altool and notarytool also look. It is never printed and never copied.

What this cannot do: create the app record itself. App Store Connect has no
API for that first step — someone opens the site once, clicks +, and gives
it the bundle id and SKU. Everything after that is here.
"""
from __future__ import annotations

import base64
import json
import os
import plistlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils as asym_utils

API = "https://api.appstoreconnect.apple.com/v1"
# In-app purchases are only on v2; everything else here is v1.
API_V2 = "https://api.appstoreconnect.apple.com/v2"
BUNDLE_ID = os.environ.get("IOS_BUNDLE_ID", "app.opensubs.mobile")
APP_NAME = os.environ.get("IOS_APP_NAME", "OpenSubs")
PROFILE_NAME = os.environ.get("IOS_PROFILE_NAME", f"{APP_NAME} App Store")

# The credit packs, and the only place the three halves of each one are
# written down together: the product id StoreKit asks for, the price Apple
# charges, and the credits the accounts server grants for it. The server's
# own app_iap_products row carries the same numbers -- see
# docs/app-store.md -- and a disagreement between the two is a purchase
# that takes money and grants nothing.
CONSUMABLES = [
    {"product_id": "opensubs_credits_1000", "credits": 1000, "usd": "4.99",
     "name": "1,000 credits",
     "description": "1,000 credits for transcribing, translating, burning."},
    {"product_id": "opensubs_credits_5000", "credits": 5000, "usd": "19.99",
     "name": "5,000 credits",
     "description": "5,000 credits for transcribing, translating, burning."},
]
KEY_DIR = Path.home() / ".appstoreconnect" / "private_keys"
WORK = Path(__file__).resolve().parent.parent / ".build" / "signing"


def die(message: str) -> "None":
    print(f"asc.py: {message}", file=sys.stderr)
    raise SystemExit(1)


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        die(f"{name} is not set — Users and Access → Integrations → Keys has both values")
    return value


def token() -> str:
    """A twenty-minute ES256 JWT, the only thing the API accepts."""
    key_id, issuer = env("ASC_KEY_ID"), env("ASC_ISSUER_ID")
    path = KEY_DIR / f"AuthKey_{key_id}.p8"
    if not path.exists():
        die(f"no key at {path} — Apple lets that file be downloaded once, so it has to be the one you kept")
    private = serialization.load_pem_private_key(path.read_bytes(), password=None)

    def part(obj: dict) -> bytes:
        return base64.urlsafe_b64encode(json.dumps(obj, separators=(",", ":")).encode()).rstrip(b"=")

    header = part({"alg": "ES256", "kid": key_id, "typ": "JWT"})
    now = int(time.time())
    payload = part({"iss": issuer, "iat": now, "exp": now + 20 * 60, "aud": "appstoreconnect-v1"})
    signed = private.sign(header + b"." + payload, ec.ECDSA(hashes.SHA256()))
    # JOSE wants the raw r||s pair, not the DER sequence OpenSSL produces.
    r, s = asym_utils.decode_dss_signature(signed)
    raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return (header + b"." + payload + b"." + base64.urlsafe_b64encode(raw).rstrip(b"=")).decode()


def call(method: str, path: str, body: dict | None = None, api: str = API,
         allow_missing: bool = False) -> dict:
    url = path if path.startswith("http") else f"{api}{path}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Authorization", f"Bearer {token()}")
    if data:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        # A relationship that has never been set answers 404 rather than an
        # empty document, so "is there a price yet" cannot be asked without it.
        if e.code == 404 and allow_missing:
            return {}
        detail = e.read().decode(errors="replace")
        try:  # Apple's errors say exactly what is wrong; show that, not the status.
            for err in json.loads(detail).get("errors", []):
                print(f"  {err.get('title')}: {err.get('detail')}", file=sys.stderr)
        except Exception:
            print(f"  {detail[:400]}", file=sys.stderr)
        die(f"{method} {path} → HTTP {e.code}")


def run(*args: str, input_bytes: bytes | None = None) -> str:
    done = subprocess.run(args, input=input_bytes, capture_output=True)
    if done.returncode != 0:
        die(f"{' '.join(args[:3])}… failed: {done.stderr.decode(errors='replace').strip()[:300]}")
    return done.stdout.decode(errors="replace")


# --- what the archive needs -----------------------------------------------------

def whoami() -> None:
    apps = call("GET", "/apps?limit=200").get("data", [])
    print(f"key {env('ASC_KEY_ID')} works. {len(apps)} app record(s):")
    for app in apps:
        a = app["attributes"]
        print(f"  {a.get('bundleId'):40} {a.get('name')}  (sku {a.get('sku')})")
    if not any(app["attributes"].get("bundleId") == BUNDLE_ID for app in apps):
        print(f"\n  {BUNDLE_ID} has no app record yet. That one step is the website's alone:")
        print(f"  App Store Connect → Apps → + → iOS, bundle id {BUNDLE_ID}, SKU opensubs-ios.")


def installed_distribution_identity() -> str | None:
    listing = run("security", "find-identity", "-v", "-p", "codesigning")
    match = re.search(r'"(Apple Distribution: [^"]+)"', listing)
    return match.group(1) if match else None


def ensure_cert() -> None:
    """An Apple Distribution certificate whose private key is in this keychain.

    The key is generated here and never leaves: Apple only ever sees the
    certificate request, and signs the public half of it.
    """
    existing = installed_distribution_identity()
    if existing:
        print(f"already have {existing}")
        return

    WORK.mkdir(parents=True, exist_ok=True)
    key_path, csr_path, cer_path = WORK / "distribution.key", WORK / "distribution.csr", WORK / "distribution.cer"
    if not key_path.exists():
        run("openssl", "genrsa", "-out", str(key_path), "2048")
        key_path.chmod(0o600)
    run("openssl", "req", "-new", "-key", str(key_path), "-out", str(csr_path),
        "-subj", f"/CN={APP_NAME} Distribution/O={APP_NAME}/C=US")

    print("asking Apple to sign the certificate request")
    created = call("POST", "/certificates", {
        "data": {"type": "certificates", "attributes": {
            "certificateType": "DISTRIBUTION",
            "csrContent": csr_path.read_text(),
        }},
    })
    cer_path.write_bytes(base64.b64decode(created["data"]["attributes"]["certificateContent"]))

    # Into the keychain as one item, so codesign can find the pair.
    pem = WORK / "distribution.pem"
    pem.write_text(run("openssl", "x509", "-inform", "DER", "-in", str(cer_path)))
    p12, password = WORK / "distribution.p12", base64.urlsafe_b64encode(os.urandom(18)).decode()
    run("openssl", "pkcs12", "-export", "-legacy", "-out", str(p12), "-inkey", str(key_path),
        "-in", str(pem), "-passout", f"pass:{password}")
    p12.chmod(0o600)
    run("security", "import", str(p12), "-k", str(Path.home() / "Library/Keychains/login.keychain-db"),
        "-P", password, "-T", "/usr/bin/codesign", "-T", "/usr/bin/security")
    p12.unlink()

    identity = installed_distribution_identity()
    print(f"installed {identity}" if identity else "the certificate imported but no identity appeared — is the WWDR intermediate present?")


def ensure_app_id() -> str:
    """The App ID Apple knows, with the capabilities the app actually uses."""
    found = call("GET", f"/bundleIds?filter[identifier]={BUNDLE_ID}&limit=200").get("data", [])
    if found:
        print(f"app id {BUNDLE_ID} exists")
        return found[0]["id"]
    print(f"registering {BUNDLE_ID}")
    created = call("POST", "/bundleIds", {
        "data": {"type": "bundleIds", "attributes": {
            "identifier": BUNDLE_ID, "name": APP_NAME, "platform": "IOS",
        }},
    })
    bundle_id = created["data"]["id"]
    # In-app purchase is what pays for the two paid tools; without it the
    # profile is valid and StoreKit finds no products at runtime.
    call("POST", "/bundleIdCapabilities", {
        "data": {"type": "bundleIdCapabilities", "attributes": {"capabilityType": "IN_APP_PURCHASE"},
                 "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bundle_id}}}},
    })
    return bundle_id


def ensure_profile() -> None:
    """The App Store profile, installed where Xcode looks for it."""
    bundle_id = ensure_app_id()
    certs = [c for c in call("GET", "/certificates?limit=200").get("data", [])
             if c["attributes"]["certificateType"] in ("DISTRIBUTION", "IOS_DISTRIBUTION")]
    if not certs:
        die("no distribution certificate on the account — run ensure-cert first")

    for profile in call("GET", "/profiles?limit=200").get("data", []):
        if profile["attributes"]["name"] == PROFILE_NAME and profile["attributes"]["profileState"] == "ACTIVE":
            print(f"profile {PROFILE_NAME} exists")
            install_profile(profile)
            return

    print(f"creating profile {PROFILE_NAME}")
    created = call("POST", "/profiles", {
        "data": {"type": "profiles", "attributes": {
            "name": PROFILE_NAME, "profileType": "IOS_APP_STORE",
        }, "relationships": {
            "bundleId": {"data": {"type": "bundleIds", "id": bundle_id}},
            "certificates": {"data": [{"type": "certificates", "id": c["id"]} for c in certs]},
        }},
    })
    install_profile(created["data"])


def install_profile(profile: dict) -> None:
    content = base64.b64decode(profile["attributes"]["profileContent"])
    # Xcode reads profiles by UUID from this directory; the name is ignored.
    plist = plistlib.loads(re.search(rb"<\?xml.*</plist>", content, re.S).group(0))
    target = Path.home() / "Library/MobileDevice/Provisioning Profiles"
    target.mkdir(parents=True, exist_ok=True)
    path = target / f"{plist['UUID']}.mobileprovision"
    path.write_bytes(content)
    print(f"installed {path.name} ({plist['Name']}, expires {plist['ExpirationDate']:%Y-%m-%d})")
    print(f"  PROVISIONING_PROFILE_SPECIFIER={plist['Name']}")


# --- what a purchase needs ------------------------------------------------------

def app_record() -> str:
    """The app id App Store Connect assigns, found by bundle id."""
    for app in call("GET", "/apps?limit=200").get("data", []):
        if app["attributes"].get("bundleId") == BUNDLE_ID:
            return app["id"]
    die(f"no app record for {BUNDLE_ID} — App Store Connect → Apps → + creates it, and only the website can")


def ensure_iaps() -> None:
    """The consumables, their English wording, and a price in every territory.

    A consumable is not one object: without a localization it has no name on
    the product page, and without a price schedule StoreKit returns it to the
    app as unavailable. All three are created here, and each step is skipped
    if it is already there, so this is safe to re-run.
    """
    app_id = app_record()
    existing = {p["attributes"]["productId"]: p["id"]
                for p in call("GET", f"/apps/{app_id}/inAppPurchasesV2?limit=200").get("data", [])}

    for item in CONSUMABLES:
        iap_id = existing.get(item["product_id"])
        if iap_id:
            print(f"{item['product_id']} exists")
        else:
            print(f"creating {item['product_id']}")
            iap_id = call("POST", "/inAppPurchases", {
                "data": {"type": "inAppPurchases", "attributes": {
                    "name": item["name"], "productId": item["product_id"],
                    "inAppPurchaseType": "CONSUMABLE", "familySharable": False,
                }, "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}},
            }, api=API_V2)["data"]["id"]
        ensure_localization(iap_id, item)
        ensure_price(iap_id, item)


def ensure_localization(iap_id: str, item: dict) -> None:
    for loc in call("GET", f"/inAppPurchases/{iap_id}/inAppPurchaseLocalizations?limit=50",
                    api=API_V2).get("data", []):
        if loc["attributes"]["locale"] == "en-US":
            print(f"  en-US wording exists: {loc['attributes']['name']}")
            return
    call("POST", "/inAppPurchaseLocalizations", {
        "data": {"type": "inAppPurchaseLocalizations", "attributes": {
            "locale": "en-US", "name": item["name"], "description": item["description"],
        }, "relationships": {"inAppPurchaseV2": {"data": {"type": "inAppPurchases", "id": iap_id}}}},
    })
    print(f"  wrote en-US wording")


def ensure_price(iap_id: str, item: dict) -> None:
    """One manual price in USD; Apple derives the other territories from it."""
    schedule = call("GET", f"/inAppPurchases/{iap_id}/iapPriceSchedule", api=API_V2,
                    allow_missing=True)
    if schedule.get("data"):
        print(f"  price schedule exists")
        return
    # Apple does not take an amount -- it takes one of its own price points,
    # which is why the tier has to be looked up rather than stated.
    points = call("GET", f"/inAppPurchases/{iap_id}/pricePoints"
                          f"?filter[territory]=USA&limit=200", api=API_V2).get("data", [])
    match = [p for p in points if p["attributes"]["customerPrice"] == item["usd"]]
    if not match:
        die(f"  no USD price point at {item['usd']} among {len(points)} offered")
    call("POST", "/inAppPurchasePriceSchedules", {
        "data": {"type": "inAppPurchasePriceSchedules", "relationships": {
            "inAppPurchase": {"data": {"type": "inAppPurchases", "id": iap_id}},
            "baseTerritory": {"data": {"type": "territories", "id": "USA"}},
            "manualPrices": {"data": [{"type": "inAppPurchasePrices", "id": "${price}"}]},
        }},
        "included": [{
            "type": "inAppPurchasePrices", "id": "${price}",
            "attributes": {"startDate": None},
            "relationships": {"inAppPurchasePricePoint": {
                "data": {"type": "inAppPurchasePricePoints", "id": match[0]["id"]}}},
        }],
    })
    print(f"  priced at ${item['usd']}")


def show_iaps() -> None:
    app_id = app_record()
    for p in call("GET", f"/apps/{app_id}/inAppPurchasesV2?limit=200").get("data", []):
        a = p["attributes"]
        # The schedule holds the price by reference, so the amount is two
        # hops away: schedule -> manualPrices -> the price point it names.
        schedule = call("GET", f"/inAppPurchases/{p['id']}/iapPriceSchedule",
                        api=API_V2, allow_missing=True)
        amount = "no price"
        if schedule.get("data"):
            prices = call("GET", f"/inAppPurchasePriceSchedules/{schedule['data']['id']}"
                                 f"/manualPrices?include=inAppPurchasePricePoint&limit=5")
            for inc in prices.get("included", []):
                if inc["type"] == "inAppPurchasePricePoints":
                    amount = f"${inc['attributes']['customerPrice']}"
        locales = [l["attributes"]["locale"] for l in
                   call("GET", f"/inAppPurchases/{p['id']}/inAppPurchaseLocalizations?limit=50",
                        api=API_V2).get("data", [])]
        print(f"  {a['productId']:26} {a['state']:22} {amount:8} {a['inAppPurchaseType']:12} {locales}")


def main() -> None:
    commands = {
        "whoami": whoami,
        "ensure-cert": ensure_cert,
        "ensure-app-id": lambda: print(f"app id record {ensure_app_id()}"),
        "ensure-profile": ensure_profile,
        "ensure-iaps": ensure_iaps,
        "show-iaps": show_iaps,
        "setup": lambda: (ensure_cert(), ensure_app_id(), ensure_profile()),
    }
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        print(__doc__)
        raise SystemExit(2)
    commands[sys.argv[1]]()


if __name__ == "__main__":
    main()
