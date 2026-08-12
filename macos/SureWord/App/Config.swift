import Foundation

/// Build-time configuration, mirroring `mobile/app.json`'s `expo.extra` block.
///
/// The publishable key is public by design (it ships inside the Android APK and
/// the web bundle already), but it is **not interchangeable**: the key encodes
/// the Clerk Frontend API host it must talk to — base64-decoding this one yields
/// `clerk.sureword.app$`. A key from the wrong instance does not degrade sign-in,
/// it takes it down outright. This file is now the *third* place that must move
/// in lockstep when Clerk keys change, alongside `mobile/app.json` and the web's
/// `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
enum Config {
    static let apiURL = URL(string: "https://sureword.app")!

    static let clerkPublishableKey = "pk_live_Y2xlcmsuc3VyZXdvcmQuYXBwJA"

    /// Registered in `Info.plist` under `CFBundleURLTypes`; Clerk's OAuth flow
    /// returns here. Must stay on Clerk's redirect allowlist.
    static let redirectScheme = "sureword"
    static let ssoCallbackURL = "sureword://sso-callback"


    static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }
}
