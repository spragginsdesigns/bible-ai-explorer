import Foundation
import XCTest

@testable import SureWord

@MainActor
final class AccountNotificationDeliveryTests: XCTestCase {
    private typealias Owner = AccountNotificationDelivery.Owner

    @MainActor
    private final class Gate {
        private var continuation: CheckedContinuation<Void, Never>?
        private var observers: [CheckedContinuation<Void, Never>] = []

        func pause() async {
            await withCheckedContinuation { continuation in
                self.continuation = continuation
                observers.forEach { $0.resume() }
                observers.removeAll()
            }
        }

        func waitUntilPaused() async {
            if continuation != nil { return }
            await withCheckedContinuation { observers.append($0) }
        }

        func release() {
            let pending = continuation
            continuation = nil
            pending?.resume()
        }
    }

    @MainActor
    private final class Center {
        var owner: Owner? = Owner(accountID: "account-a", sessionID: "session-a")
        var authorizationCalls = 0
        var added: [String] = []
        var removed: [String] = []
        var pending: Set<String> = []
        var delivered: Set<String> = []

        func add(_ identifier: String) {
            added.append(identifier)
            pending.insert(identifier)
            delivered.insert(identifier)
        }

        func remove(_ identifier: String) {
            removed.append(identifier)
            pending.remove(identifier)
            delivered.remove(identifier)
        }

        func clearForAccountChange() {
            pending.removeAll()
            delivered.removeAll()
        }
    }

    private func ticket(_ delivery: AccountNotificationDelivery, _ center: Center) throws -> AccountNotificationDelivery.Ticket {
        try XCTUnwrap(delivery.ticket(accountID: center.owner?.accountID, baseIdentifier: "chat-conversation", currentOwner: { center.owner }))
    }

    func testCurrentOwnerCanDeliverAndConversationIdentifierDeduplicatesWithinGeneration() async throws {
        let delivery = AccountNotificationDelivery()
        let center = Center()
        let first = try ticket(delivery, center)
        let second = try ticket(delivery, center)
        XCTAssertEqual(first.identifier, second.identifier)

        for item in [first, second] {
            await delivery.deliver(
                item, currentOwner: { center.owner },
                authorized: { center.authorizationCalls += 1; return true },
                eligible: { $0 },
                add: { center.add($0) }, remove: { center.remove($0) }
            )
        }
        XCTAssertEqual(center.authorizationCalls, 2)
        XCTAssertEqual(center.added.count, 2, "A later answer in this conversation must still replace its notice")
        XCTAssertEqual(center.delivered.count, 1)
        XCTAssertTrue(center.removed.isEmpty)
    }

    func testNoAuthenticationOrMismatchedOwnerCannotAcquireOrUseATicket() async throws {
        let delivery = AccountNotificationDelivery()
        let center = Center()
        XCTAssertNil(delivery.ticket(accountID: nil, baseIdentifier: "chat-conversation", currentOwner: { center.owner }))
        XCTAssertNil(delivery.ticket(accountID: "account-b", baseIdentifier: "chat-conversation", currentOwner: { center.owner }))
        XCTAssertNil(delivery.ticket(accountID: "account-a", baseIdentifier: "chat-conversation", currentOwner: { nil }))
        XCTAssertNil(delivery.ticket(accountID: "account-a", baseIdentifier: "chat-conversation", currentOwner: {
            Owner(accountID: "account-a", sessionID: "")
        }))

        let queued = try ticket(delivery, center)
        center.owner = nil
        await delivery.deliver(
            queued, currentOwner: { center.owner },
            authorized: { center.authorizationCalls += 1; return true },
            eligible: { $0 }, add: { center.add($0) }, remove: { center.remove($0) }
        )
        XCTAssertEqual(center.authorizationCalls, 0, "Reject stale work before awaiting permission")
        XCTAssertTrue(center.added.isEmpty)
    }

    func testAccountChangeWhilePermissionIsPendingPreventsAdd() async throws {
        let delivery = AccountNotificationDelivery()
        let center = Center()
        let queued = try ticket(delivery, center)
        let permission = Gate()
        let work = Task {
            await delivery.deliver(
                queued, currentOwner: { center.owner },
                authorized: {
                    center.authorizationCalls += 1
                    await permission.pause()
                    return true
                },
                eligible: { $0 }, add: { center.add($0) }, remove: { center.remove($0) }
            )
        }
        await permission.waitUntilPaused()
        delivery.invalidateForAccountChange()
        center.owner = Owner(accountID: "account-b", sessionID: "session-b")
        center.clearForAccountChange()
        permission.release()
        await work.value
        XCTAssertEqual(center.authorizationCalls, 1)
        XCTAssertTrue(center.added.isEmpty)
        XCTAssertTrue(center.delivered.isEmpty)
    }

    func testAccountChangeWhileSystemAddIsPendingRemovesItsLateArrival() async throws {
        let delivery = AccountNotificationDelivery()
        let center = Center()
        let queued = try ticket(delivery, center)
        let adding = Gate()
        let work = Task {
            await delivery.deliver(
                queued, currentOwner: { center.owner }, authorized: { true }, eligible: { $0 },
                add: { identifier in
                    await adding.pause()
                    center.add(identifier) // OS acceptance occurs after the shell cleared it.
                },
                remove: { center.remove($0) }
            )
        }
        await adding.waitUntilPaused()
        delivery.invalidateForAccountChange()
        center.owner = Owner(accountID: "account-b", sessionID: "session-b")
        center.clearForAccountChange()
        adding.release()
        await work.value
        XCTAssertEqual(center.added, [queued.identifier])
        XCTAssertEqual(center.removed, [queued.identifier])
        XCTAssertTrue(center.pending.isEmpty)
        XCTAssertTrue(center.delivered.isEmpty)
    }

    func testSwitchAwayAndBackCannotReviveAnOldTicketEvenWhenSessionIsReused() async throws {
        let delivery = AccountNotificationDelivery()
        let center = Center()
        let original = center.owner
        let queued = try ticket(delivery, center)
        let permission = Gate()
        let work = Task {
            await delivery.deliver(
                queued, currentOwner: { center.owner },
                authorized: { await permission.pause(); return true },
                eligible: { $0 }, add: { center.add($0) }, remove: { center.remove($0) }
            )
        }
        await permission.waitUntilPaused()
        delivery.invalidateForAccountChange()
        center.owner = Owner(accountID: "account-b", sessionID: "session-b")
        delivery.invalidateForAccountChange()
        center.owner = original
        permission.release()
        await work.value
        XCTAssertTrue(center.added.isEmpty)
        let fresh = try ticket(delivery, center)
        XCTAssertNotEqual(fresh.identifier, queued.identifier)
    }

    func testSessionChangeWithSameAccountAlsoPreventsPendingDelivery() async throws {
        let delivery = AccountNotificationDelivery()
        let center = Center()
        let queued = try ticket(delivery, center)
        let permission = Gate()
        let work = Task {
            await delivery.deliver(
                queued, currentOwner: { center.owner },
                authorized: { await permission.pause(); return true },
                eligible: { $0 }, add: { center.add($0) }, remove: { center.remove($0) }
            )
        }
        await permission.waitUntilPaused()
        center.owner = Owner(accountID: "account-a", sessionID: "new-session")
        permission.release()
        await work.value
        XCTAssertTrue(center.added.isEmpty)
    }

    func testOldPostAddCleanupCannotRemoveFreshNoticeForTheSameConversation() async throws {
        let delivery = AccountNotificationDelivery()
        let center = Center()
        let stale = try ticket(delivery, center)
        let adding = Gate()
        let oldWork = Task {
            await delivery.deliver(
                stale, currentOwner: { center.owner }, authorized: { true }, eligible: { $0 },
                add: { identifier in await adding.pause(); center.add(identifier) },
                remove: { center.remove($0) }
            )
        }
        await adding.waitUntilPaused()
        delivery.invalidateForAccountChange()
        center.owner = Owner(accountID: "account-b", sessionID: "session-b")
        center.clearForAccountChange()
        let fresh = try ticket(delivery, center)
        await delivery.deliver(
            fresh, currentOwner: { center.owner }, authorized: { true }, eligible: { $0 },
            add: { center.add($0) }, remove: { center.remove($0) }
        )
        XCTAssertNotEqual(stale.identifier, fresh.identifier)
        adding.release()
        await oldWork.value
        XCTAssertEqual(center.removed, [stale.identifier])
        XCTAssertEqual(center.pending, [fresh.identifier])
        XCTAssertEqual(center.delivered, [fresh.identifier])
    }

    func testPermissionOrEligibilityDenialStillDoesNotAdd() async throws {
        for (authorized, wanted) in [(false, true), (true, false)] {
            let delivery = AccountNotificationDelivery()
            let center = Center()
            let queued = try ticket(delivery, center)
            await delivery.deliver(
                queued, currentOwner: { center.owner }, authorized: { authorized },
                eligible: { $0 && wanted }, add: { center.add($0) }, remove: { center.remove($0) }
            )
            XCTAssertTrue(center.added.isEmpty)
        }
    }
}
