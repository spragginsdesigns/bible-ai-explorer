import ClerkKit
import ClerkKitUI
import SwiftUI

@main
struct SureWordApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var settings = SettingsStore()
    @State private var root = RootModel()

    init() {
        Clerk.configure(
            publishableKey: Config.clerkPublishableKey,
            options: .init(
                // No access group on purpose. Naming one would select the
                // data-protection keychain, but that needs a
                // `keychain-access-groups` entitlement, which a sandboxed macOS
                // app can only carry with an embedded provisioning profile — and
                // that needs a paid membership. Adding it unauthorized hangs the
                // app in `_libsecinit_initializer` before main(); adding it while
                // ad-hoc signed fails every keychain call with OSStatus -34018.
                //
                // So ClerkKit uses the legacy keychain here. That is only safe
                // because the app has a *stable* signing identity: the keychain
                // ACL is bound to the app's designated requirement, and an ad-hoc
                // signature changes it on every build, which is what made
                // `configure()` block on a consent prompt during development.
                // Clerk's default redirect is `{bundleID}://callback`, which is
                // NOT on this instance's allowlist. Production Clerk rejects
                // unlisted redirects *silently*, so leaving this at the default
                // would fail sign-in with no error — the exact failure mode
                // recorded in CLAUDE.md. These two values must stay in sync with
                // the dashboard's allowlist and with Info.plist's URL scheme.
                redirectConfig: .init(
                    redirectUrl: Config.ssoCallbackURL,
                    callbackUrlScheme: Config.redirectScheme
                )
            )
        )
    }

    var body: some Scene {
        WindowGroup {
            RootView(root: root)
                .prefetchClerkImages()
                // Clerk's OAuth round-trip returns through the `sureword://`
                // scheme; without this the browser hands back a callback the app
                // never consumes and sign-in hangs on the last step.
                .onOpenURL { url in
                    Task { try? await Clerk.shared.handle(url) }
                }
                .handlesExternalEvents(preferring: ["*"], allowing: ["*"])
                // Injected last, so it is the outermost modifier: anything
                // applied *after* `.environment` wraps the injection instead of
                // sitting inside it, and Clerk's own modifiers read
                // `@Environment(Clerk.self)` — getting this order wrong traps at
                // launch with "No Observable object of type Clerk found".
                .environment(Clerk.shared)
                .environment(settings)
        }
        .defaultSize(width: 1180, height: 820)
        .windowToolbarStyle(.unified)
        .commands { AppCommands(app: root.app) }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Reopen a window when the app is activated with none open. If SureWord is
    /// force-quit, macOS saves "no windows" and the next launch restores exactly
    /// that — the app runs with no UI at all and looks broken. Clicking the Dock
    /// icon is then the recovery, and this is what makes it work.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
}

/// Holds the signed-in `AppModel` so the menu commands can reach it from the
/// scene, outside the view hierarchy.
@MainActor
@Observable
final class RootModel {
    var app: AppModel?
}

/// Chooses between the signed-out and signed-in shells, and owns theme resolution.
struct RootView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(SettingsStore.self) private var settings
    @Environment(\.colorScheme) private var systemScheme

    @Bindable var root: RootModel

    private var scheme: ColorScheme {
        settings.appearance.colorScheme ?? systemScheme
    }

    var body: some View {
        Group {
            if clerk.user == nil {
                SignInView()
            } else if let app = root.app {
                MainWindow().environment(app)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .sureWordTheme(for: scheme)
        .preferredColorScheme(settings.appearance.colorScheme)
        .environment(\.clerkTheme, .sureWord(scheme: scheme))
        // The API client's token provider needs a live Clerk session, so the
        // model is built on sign-in and torn down on sign-out — that teardown
        // is also what clears the previous user's conversations from memory.
        .onChange(of: clerk.user?.id, initial: true) { _, userID in
            root.app = userID == nil ? nil : AppModel(settings: settings)
        }
    }
}
