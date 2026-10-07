import SwiftUI

// MARK: - Request

/// `DELETE /api/account` (`src/app/api/account/route.ts`, docs/FEATURES.md
/// "Account deletion"). The body must be exactly `{"confirm":"DELETE"}` or the
/// route answers 400 - the server's own guard against an accidental call.
///
/// Status contract the client relies on:
/// - 200: everything is gone (database rows, blobs, the Clerk user).
/// - 500: aborted before the database transaction; nothing was removed.
/// - 502: the data is gone but deleting the Clerk user failed; retrying is safe.
/// - 401: no session. After an attempt that may already have gone through (a
///   502, or a request whose answer was lost), this means the Clerk user is
///   gone, i.e. the deletion finished.
enum AccountDeletion {
    static let path = "/api/account"
    static let method = "DELETE"

    struct Body: Encodable, Equatable, Sendable {
        var confirm = "DELETE"
    }

    /// The word the second confirmation step asks the user to type.
    static let confirmationWord = "DELETE"
}

/// What the deletion flow needs from the network, so the model can be driven
/// by a fake in tests.
protocol AccountDeletionTransport: Sendable {
    func deleteAccount() async throws
}

extension APIClient: AccountDeletionTransport {
    func deleteAccount() async throws {
        try await data(AccountDeletion.path, method: AccountDeletion.method, body: AccountDeletion.Body())
    }
}

// MARK: - Model

/// Drives Settings -> Account -> Delete account on both Apple clients.
@MainActor
@Observable
final class AccountDeletionModel {
    enum Phase: Equatable {
        case idle
        case deleting
        case failed(String)
        case deleted
    }

    private(set) var phase: Phase = .idle
    /// True once an attempt may have reached the server and done its work: a
    /// 502 (data gone, Clerk user not) or a lost response. A 401 after that is
    /// the Clerk user being gone, which is success.
    private(set) var mayHaveDeleted = false

    static let failedNothingRemoved =
        "Couldn't delete your account. Nothing was removed. Please try again."
    static let failedRetryable =
        "Couldn't finish deleting your account. Please try again."
    static let failedNetwork =
        "Couldn't reach SureWord. Check your connection and try again."
    static let failedSession =
        "Your session expired. Sign in again, then delete your account."

    var isDeleting: Bool { phase == .deleting }

    var errorMessage: String? {
        if case .failed(let message) = phase { return message }
        return nil
    }

    func dismissError() {
        if case .failed = phase { phase = .idle }
    }

    /// Runs the request and returns true when the account is gone. The caller
    /// then clears local state and signs out.
    @discardableResult
    func delete(using transport: any AccountDeletionTransport) async -> Bool {
        guard phase != .deleting, phase != .deleted else { return phase == .deleted }
        phase = .deleting
        do {
            try await transport.deleteAccount()
            phase = .deleted
            return true
        } catch let error as APIError {
            switch error.status {
            case 401 where mayHaveDeleted:
                phase = .deleted
                return true
            case 401:
                phase = .failed(Self.failedSession)
            case 502:
                mayHaveDeleted = true
                phase = .failed(Self.failedRetryable)
            case .some:
                phase = .failed(Self.failedNothingRemoved)
            case nil:
                // No status: the request may have been sent and processed
                // before the connection dropped.
                mayHaveDeleted = true
                phase = .failed(error.isOffline ? Self.failedNetwork : Self.failedRetryable)
            }
        } catch {
            mayHaveDeleted = true
            phase = .failed(Self.failedRetryable)
        }
        return false
    }
}

// MARK: - View

/// The "Delete account" row for the Account section of both Settings screens,
/// with its two-step confirmation: a destructive dialog that spells out what
/// goes, then an alert that asks for the word DELETE before anything is sent.
/// On success it clears the per-account caches the way sign-out does, then
/// signs out of Clerk, which returns both apps to the sign-in screen.
struct DeleteAccountRow: View {
    let app: AppModel
    var onDeleted: () -> Void = {}

    @State private var model = AccountDeletionModel()
    @State private var isConfirming = false
    @State private var isTypingConfirmation = false
    @State private var typed = ""

    var body: some View {
        Button(role: .destructive) {
            isConfirming = true
        } label: {
            if model.isDeleting {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Deleting account…")
                }
            } else {
                Text("Delete account")
            }
        }
        .disabled(model.isDeleting || model.phase == .deleted)
        .accessibilityHint("Permanently deletes your SureWord account and data")
        .confirmationDialog(
            "Delete your SureWord account?",
            isPresented: $isConfirming,
            titleVisibility: .visible
        ) {
            Button("Continue", role: .destructive) {
                typed = ""
                isTypingConfirmation = true
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "This permanently deletes your conversations, notes, highlights, memories, "
                    + "testimony, voice messages and your account. This can't be undone."
            )
        }
        .alert("Type DELETE to confirm", isPresented: $isTypingConfirmation) {
            TextField(AccountDeletion.confirmationWord, text: $typed)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.characters)
                #endif
            Button("Delete account", role: .destructive) {
                guard isConfirmed else { return }
                Task { await run() }
            }
            .disabled(!isConfirmed)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your account and everything in it will be deleted for good.")
        }
        .alert(
            "Account not deleted",
            isPresented: Binding(
                get: { model.errorMessage != nil },
                set: { if !$0 { model.dismissError() } }
            )
        ) {
            Button("Try again", role: .destructive) { Task { await run() } }
            Button("Cancel", role: .cancel) { model.dismissError() }
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    private var isConfirmed: Bool {
        typed.trimmingCharacters(in: .whitespacesAndNewlines) == AccountDeletion.confirmationWord
    }

    private func run() async {
        guard await model.delete(using: app.api) else { return }
        // The same per-account wipe the sign-out path runs from the app roots'
        // `onChange(of: clerk.user?.id)`, done here first with the live stores
        // so nothing from the deleted account survives a slow Clerk sign-out.
        PreferencesSyncModel.clearAccountCaches(settings: app.settings, highlights: app.highlights)
        await ClerkAuth.signOutAfterAccountDeletion()
        onDeleted()
    }
}
