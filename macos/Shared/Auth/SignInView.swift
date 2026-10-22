import AuthenticationServices
import ClerkKit
import ClerkKitUI
import SwiftUI

/// Signed-out screen.
///
/// The forms themselves are ClerkKitUI's `AuthView`, deliberately rather than a
/// hand-rolled flow: it picks up whatever strategies the Clerk dashboard has
/// enabled, and handles verification, continuations and MFA. This repo has
/// already paid for hand-rolling Clerk plumbing once (see the Frontend API
/// proxy post-mortem in `CLAUDE.md`), so the supported component wins, themed
/// to match SureWord.
///
/// What this screen adds is the choice in front of it, mirroring Android 1.99.0
/// (`mobile/app/(auth)/sign-in.tsx`): closed testers could not tell how to make
/// an account behind a lone "Sign in" button, so the welcome card offers
/// Create an account and Sign in, with the one-tap providers under both.
/// Sign in opens the sign-in-or-up flow, so an email with no account yet
/// carries on into creating one instead of dead-ending, as Android's
/// "Create an account with this email" does.
///
/// Password sign-in is still Android 1.19.1's path for the review demo account:
/// the instance prefers it, so Continue opens "Enter password" for an account
/// that has one, with "Use another method" for the email code (LC-16620).
struct SignInView: View {
    @Environment(\.theme) private var theme
    @State private var authMode: AuthSheetMode?
    @State private var busyProvider: OAuthProvider?
    @State private var message: String?

    var body: some View {
        ZStack {
            MeshBackground()

            ScrollView {
                VStack(spacing: Spacing.xl) {
                    VStack(spacing: Spacing.sm) {
                        BrandMark(size: 52)
                        Text("Scripture-rooted study, grounded in the King James Bible.")
                            .font(.system(size: 14))
                            .foregroundStyle(theme.textMuted)
                            .multilineTextAlignment(.center)
                    }

                    GlassCard {
                        welcomeCard
                    }
                    .frame(maxWidth: 380)
                }
                .padding(Spacing.xxl)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        // A window-sized minimum on the Mac; on iOS the screen sizes itself.
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 520)
        #endif
        .analyticsScreen(AnalyticsScreen.signIn)
        .sheet(item: $authMode) { mode in
            AuthView(mode: mode.clerkMode)
        }
        .task {
            // Clerk raises these when a flow needs the user back, e.g. an OAuth
            // round-trip that returned needing a second factor. Without this the
            // sheet stays closed and the sign-in silently stalls.
            for await event in Clerk.shared.auth.events {
                switch event {
                case .signInNeedsContinuation, .signUpNeedsContinuation:
                    if authMode == nil { authMode = .signInOrUp }
                default:
                    break
                }
            }
        }
    }

    private var welcomeCard: some View {
        VStack(spacing: Spacing.md) {
            VStack(spacing: Spacing.xs) {
                Text("Welcome to SureWord")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(theme.text)
                Text("New here? Create a free account. Already have one? Sign in.")
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textMuted)
                    .multilineTextAlignment(.center)
            }

            Button {
                openAuth(.signUp)
            } label: {
                Text("Create an account").frame(maxWidth: .infinity)
            }
            .buttonStyle(AccentButtonStyle())
            .accessibilityIdentifier("auth-create-account")

            Button {
                openAuth(.signInOrUp)
            } label: {
                Text("Sign in").frame(maxWidth: .infinity)
            }
            .buttonStyle(OutlineAuthButtonStyle())
            .accessibilityIdentifier("auth-sign-in")

            HStack(spacing: Spacing.sm) {
                Rectangle().fill(theme.border).frame(height: 1)
                Text("or")
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textGhost)
                Rectangle().fill(theme.border).frame(height: 1)
            }

            // App Review 4.8: an app offering Google sign-in must offer Sign in
            // with Apple alongside it. Only the iOS target carries the
            // entitlement; the Mac ships outside the App Store.
            #if os(iOS)
            providerButton(.apple, identifier: "auth-apple")
            #endif
            providerButton(.google, identifier: "auth-google")

            if let message {
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.danger)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("auth-message")
            } else {
                Text(AuthWelcomeCopy.providerFootnote)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textGhost)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private func providerButton(_ provider: OAuthProvider, identifier: String) -> some View {
        Button {
            Task { await continueWith(provider) }
        } label: {
            HStack(spacing: Spacing.sm) {
                if busyProvider == provider {
                    ProgressView().controlSize(.small)
                }
                Text("Continue with \(provider.name)")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(OutlineAuthButtonStyle())
        .disabled(busyProvider != nil)
        .accessibilityIdentifier(identifier)
    }

    private func openAuth(_ mode: AuthSheetMode) {
        message = nil
        authMode = mode
    }

    /// One tap straight into the provider, the same as Android's Continue with
    /// Google: the transfer flag lets a first-time Google or Apple account
    /// create its SureWord account in the same round trip.
    private func continueWith(_ provider: OAuthProvider) async {
        message = nil
        busyProvider = provider
        defer { busyProvider = nil }
        do {
            let result: TransferFlowResult = if provider == .apple {
                try await Clerk.shared.auth.signInWithApple()
            } else {
                try await Clerk.shared.auth.signInWithOAuth(provider: provider)
            }
            // A complete result has already activated the session, and the app
            // root swaps this screen out on its own.
            switch result {
            case .signIn(let signIn) where signIn.status != .complete:
                message = AuthWelcomeCopy.providerIncomplete(provider.name)
            case .signUp(let signUp) where signUp.status != .complete:
                message = AuthWelcomeCopy.providerIncomplete(provider.name)
            default:
                break
            }
        } catch {
            // Closing the provider's sheet is a choice, not a failure; Android
            // stays silent on it too.
            guard !AuthWelcomeCopy.isCancellation(error) else { return }
            message = AuthWelcomeCopy.providerFailed(provider.name, error: error)
        }
    }
}

/// Which `AuthView` the sheet shows. `AuthView.Mode` is not `Identifiable`, so
/// it rides in this wrapper to drive `.sheet(item:)`.
enum AuthSheetMode: String, Identifiable {
    case signUp
    case signInOrUp

    var id: String { rawValue }

    var clerkMode: AuthView.Mode {
        switch self {
        case .signUp: .signUp
        case .signInOrUp: .signInOrUp
        }
    }
}

/// The welcome card's words, kept out of the view so they are testable and
/// stay in step with `mobile/src/features/auth/authErrors.ts`.
enum AuthWelcomeCopy {
    static var providerFootnote: String {
        #if os(iOS)
        "Apple and Google work for new and existing accounts."
        #else
        "Google works for new and existing accounts."
        #endif
    }

    /// The provider came back without a session: Clerk wants a step the
    /// provider did not cover. Point at the path that always works.
    static func providerIncomplete(_ providerName: String) -> String {
        "\(providerName) signed you in, but we couldn't finish setting up your account. "
            + "Please try again, or use Create an account with your email."
    }

    static func providerFailed(_ providerName: String, error: Error) -> String {
        if let clerkError = error as? ClerkAPIError {
            return clerkError.longMessage ?? clerkError.message ?? genericFailure(providerName)
        }
        return genericFailure(providerName)
    }

    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        let nsError = error as NSError
        if nsError.domain == ASWebAuthenticationSessionError.errorDomain {
            return nsError.code == ASWebAuthenticationSessionError.Code.canceledLogin.rawValue
        }
        if nsError.domain == ASAuthorizationError.errorDomain {
            return nsError.code == ASAuthorizationError.Code.canceled.rawValue
        }
        return false
    }

    private static func genericFailure(_ providerName: String) -> String {
        "\(providerName) sign-in didn't go through. Please try again, or use Create an account with your email."
    }
}

/// The welcome card's secondary buttons: the accent pill's shape with a quiet
/// fill, so Create an account stays the one primary action.
private struct OutlineAuthButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(isEnabled ? theme.text : theme.textGhost)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
            .background(
                configuration.isPressed ? theme.surfacePressed : theme.surface,
                in: .rect(cornerRadius: Radius.full)
            )
            .overlay {
                Capsule().strokeBorder(theme.border, lineWidth: 1)
            }
            .contentShape(.capsule)
            .opacity(isEnabled ? 1 : 0.6)
    }
}
