import ClerkKit
import ClerkKitUI
import SwiftUI

/// Signed-out screen.
///
/// The sign-in form itself is ClerkKitUI's `AuthView`, deliberately rather than a
/// hand-rolled flow: it picks up whatever strategies the Clerk dashboard has
/// enabled (email code + Google SSO here), and handles verification,
/// continuations and MFA. This repo has already paid for hand-rolling Clerk
/// plumbing once — see the Frontend API proxy post-mortem in `CLAUDE.md` — so the
/// supported component wins, themed to match SureWord.
struct SignInView: View {
    @Environment(\.theme) private var theme
    @State private var authIsPresented = false

    var body: some View {
        ZStack {
            MeshBackground()

            VStack(spacing: Spacing.xl) {
                VStack(spacing: Spacing.sm) {
                    BrandMark(size: 52)
                    Text("Scripture-rooted study, grounded in the King James Bible.")
                        .font(.system(size: 14))
                        .foregroundStyle(theme.textMuted)
                        .multilineTextAlignment(.center)
                }

                Button("Sign in") { authIsPresented = true }
                    .buttonStyle(AccentButtonStyle())
            }
            .padding(Spacing.xxl)
        }
        // A window-sized minimum on the Mac; on iOS the screen sizes itself.
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 420)
        #endif
        .sheet(isPresented: $authIsPresented) {
            AuthView()
        }
        .task {
            // Clerk raises these when a flow needs the user back — e.g. an OAuth
            // round-trip that returned needing a second factor. Without this the
            // sheet stays closed and the sign-in silently stalls.
            for await event in Clerk.shared.auth.events {
                switch event {
                case .signInNeedsContinuation, .signUpNeedsContinuation:
                    authIsPresented = true
                default:
                    break
                }
            }
        }
    }
}
