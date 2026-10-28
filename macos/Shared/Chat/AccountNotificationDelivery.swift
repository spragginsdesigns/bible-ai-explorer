import Foundation

/// Account/session fencing for an asynchronous local notification delivery.
/// MainActor serialization makes invalidation synchronous with the shell's
/// account transition and OS-notification cleanup. No auth SDK or OS APIs here.
@MainActor
final class AccountNotificationDelivery {
    struct Owner: Equatable, Sendable {
        let accountID: String
        let sessionID: String
    }

    struct Ticket: Sendable {
        fileprivate let owner: Owner
        fileprivate let generation: UUID
        let identifier: String
    }

    private var generation = UUID()

    /// Must run before the shell clears local notifications, including A->B->A
    /// transitions where Clerk may expose the same account/session again.
    func invalidateForAccountChange() {
        generation = UUID()
    }

    /// Capture before creating the asynchronous delivery Task. A task scheduled
    /// after an account change must never acquire the new generation's ticket.
    func ticket(
        accountID: String?,
        baseIdentifier: String,
        currentOwner: @MainActor () -> Owner?
    ) -> Ticket? {
        guard let accountID, !accountID.isEmpty, !baseIdentifier.isEmpty,
              let owner = currentOwner(), owner.accountID == accountID,
              !owner.sessionID.isEmpty
        else { return nil }
        return Ticket(
            owner: owner,
            generation: generation,
            // Stable for repeated notices in this conversation/generation, but
            // distinct after invalidation so stale cleanup cannot erase a new one.
            identifier: baseIdentifier + "-local-" + generation.uuidString
        )
    }

    func deliver(
        _ ticket: Ticket,
        currentOwner: @MainActor () -> Owner?,
        authorized: @MainActor () async -> Bool,
        eligible: @MainActor (Bool) -> Bool,
        add: @MainActor (String) async throws -> Void,
        remove: @MainActor (String) -> Void
    ) async {
        guard isCurrent(ticket, currentOwner: currentOwner) else { return }
        let permission = await authorized()
        guard isCurrent(ticket, currentOwner: currentOwner), eligible(permission) else { return }
        do {
            try await add(ticket.identifier)
        } catch {
            // A failed async add may still have reached the system. If its owner
            // changed while awaiting, retire only this generation's identifier.
            if !isCurrent(ticket, currentOwner: currentOwner) { remove(ticket.identifier) }
            return
        }
        // An account switch can clear the OS center while add is suspended.
        // The just-completed stale add must then clean up its own late arrival.
        if !isCurrent(ticket, currentOwner: currentOwner) { remove(ticket.identifier) }
    }

    private func isCurrent(_ ticket: Ticket, currentOwner: @MainActor () -> Owner?) -> Bool {
        !Task.isCancelled && ticket.generation == generation && currentOwner() == ticket.owner
    }
}
