import Foundation
import Testing
@testable import SureWord

/// No AppModel instance: constructing one starts account/authentication work.
/// The isolated intent/epoch closure drives the same Request.perform used by
/// both shipping apps, against the real coalescing departure coordinator.
@Suite("Note navigation ordering", .serialized)
@MainActor
struct NoteNavigationOrderingTests {
    @MainActor
    private final class HeldSave {
        private var continuation: CheckedContinuation<Bool, Never>?
        private var timeout: Task<Void, Never>?
        private(set) var calls = 0

        func flush() async -> Bool {
            calls += 1
            return await withCheckedContinuation { continuation in
                self.continuation = continuation
                timeout = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(10)) }
                    catch { return }
                    self?.complete(false)
                }
            }
        }

        func complete(_ success: Bool) {
            timeout?.cancel()
            timeout = nil
            let waiting = continuation
            continuation = nil
            waiting?.resume(returning: success)
        }
    }

    @MainActor
    private final class Routes {
        let store = NotesStore(cacheURL: nil, allowsEphemeralLedger: true)
        let departure = NoteDepartureCoordinator()
        let save = HeldSave()
        private var intentID = UUID()
        private(set) var checks: [UUID: Int] = [:]
        var selectedNoteID: String? = "original-note"
        var pendingNoteID: String?
        var closedAI = false
        var completionOrder: [String] = []

        init() {
            store.bindAccount("synthetic-navigation-owner")
            let save = self.save
            departure.register(owner: UUID()) { await save.flush() }
        }

        func begin() -> AppModel.NoteNavigationRequest {
            intentID = UUID()
            pendingNoteID = nil
            return current()
        }

        func current() -> AppModel.NoteNavigationRequest {
            AppModel.NoteNavigationRequest(intentID: intentID, epoch: store.epoch)
        }

        func perform(_ request: AppModel.NoteNavigationRequest, action: @MainActor () -> Void) async -> Bool {
            await request.perform(
                isCurrent: {
                    self.checks[request.intentID, default: 0] += 1
                    return !Task.isCancelled && self.store.isCurrent(request.epoch)
                        && self.intentID == request.intentID
                },
                departure: departure,
                action: action
            )
        }
    }

    private func wait(
        _ condition: @MainActor () -> Bool,
        _ message: String,
        sourceLocation: SourceLocation = #_sourceLocation
    ) async throws {
        let deadline = ContinuousClock.now + .seconds(4)
        while !condition(), ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(5))
        }
        try #require(condition(), "Timed out waiting for \(message)", sourceLocation: sourceLocation)
    }

    @Test("A later row defeats a held receipt when task results are observed in either order", arguments: [false, true])
    func newerRowWinsCoalescedDeparture(observeNewerFirst: Bool) async throws {
        let routes = Routes()
        defer { routes.save.complete(false) }
        let receipt = routes.begin()
        let older = Task {
            let applied = await routes.perform(receipt) {
                routes.closedAI = true
                routes.pendingNoteID = "receipt-note"
                routes.selectedNoteID = "receipt-note"
            }
            routes.completionOrder.append("receipt")
            return applied
        }
        defer { older.cancel() }
        try await wait({ routes.save.calls == 1 }, "the receipt's held autosave")

        let row = routes.begin()
        let newer = Task {
            let applied = await routes.perform(row) { routes.selectedNoteID = "row-note" }
            routes.completionOrder.append("row")
            return applied
        }
        defer { newer.cancel() }
        try await wait({ routes.checks[row.intentID] == 1 }, "the newer row joining departure")
        #expect(routes.save.calls == 1, "Both routes must share one real coordinator save")
        #expect(routes.selectedNoteID == "original-note")
        routes.save.complete(true)

        let results: (older: Bool, newer: Bool)
        if observeNewerFirst {
            let newerResult = await newer.value
            results = (await older.value, newerResult)
        } else {
            let olderResult = await older.value
            results = (olderResult, await newer.value)
        }
        #expect(!results.older && results.newer)
        #expect(routes.save.calls == 1)
        #expect(routes.checks[receipt.intentID] == 2 && routes.checks[row.intentID] == 2,
                "Both coalesced waiters must run the shipping post-save guard")
        #expect(routes.selectedNoteID == "row-note")
        #expect(routes.pendingNoteID == nil)
        #expect(!routes.closedAI, "A stale receipt must not close the AI surface")
        #expect(Set(routes.completionOrder) == Set(["receipt", "row"]))
    }

    @Test("An older request started after a newer row cannot even flush")
    func staleBeforeDepartureDoesNotFlush() async {
        let routes = Routes()
        let stale = routes.begin()
        _ = routes.begin()
        let applied = await routes.perform(stale) { routes.selectedNoteID = "stale-note" }
        #expect(!applied)
        #expect(routes.save.calls == 0)
        #expect(routes.checks[stale.intentID] == 1)
        #expect(routes.selectedNoteID == "original-note")
    }

    @Test("A current request registered first rejects a later-started stale waiter without another save")
    func newestRegistersBeforeStaleRequest() async throws {
        let routes = Routes()
        defer { routes.save.complete(false) }
        let stale = routes.begin()
        let current = routes.begin()
        let navigating = Task {
            await routes.perform(current) { routes.selectedNoteID = "current-note" }
        }
        defer { navigating.cancel() }
        try await wait({ routes.save.calls == 1 }, "the newest request's held autosave")
        let staleApplied = await routes.perform(stale) { routes.selectedNoteID = "stale-note" }
        #expect(!staleApplied)
        #expect(routes.checks[stale.intentID] == 1, "The stale waiter must stop before canLeave")
        #expect(routes.save.calls == 1)
        routes.save.complete(true)
        #expect(await navigating.value)
        #expect(routes.selectedNoteID == "current-note")
        #expect(routes.save.calls == 1)
    }

    @Test("A successful earlier gate cannot authorize a final action after intent or epoch changes", arguments: [false, true])
    func finalActionRechecksAfterHeldCallerReturn(changeEpoch: Bool) async throws {
        let routes = Routes()
        let callerReturn = HeldSave()
        defer {
            routes.save.complete(false)
            callerReturn.complete(false)
        }
        let request = routes.begin()
        var passedFirstGate = false
        var finalActions = 0
        let navigating = Task {
            passedFirstGate = await routes.perform(request, action: {})
            guard passedFirstGate else { return false }
            // Hold after the first shipping seam returns, just as detached
            // share intake can suspend before its final destination action.
            guard await callerReturn.flush() else { return false }
            return await routes.perform(request) {
                finalActions += 1
                routes.selectedNoteID = "stale-final-note"
            }
        }
        defer { navigating.cancel() }
        try await wait({ routes.save.calls == 1 }, "the initial departure gate")
        routes.save.complete(true)
        try await wait({ callerReturn.calls == 1 }, "the held caller return before final action")
        #expect(passedFirstGate)
        #expect(finalActions == 0)
        if changeEpoch { routes.store.bindAccount("new-owner-after-gate") }
        else { _ = routes.begin() }
        callerReturn.complete(true)
        #expect(!(await navigating.value))
        #expect(finalActions == 0)
        #expect(routes.selectedNoteID == "original-note")
        #expect(routes.save.calls == 1, "The stale final action must stop before another flush")
    }

    @Test("An account epoch change rejects a held route after save")
    func epochChangesDuringDeparture() async throws {
        let routes = Routes()
        defer { routes.save.complete(false) }
        let request = routes.begin()
        let navigating = Task {
            await routes.perform(request) { routes.selectedNoteID = "old-account-note" }
        }
        defer { navigating.cancel() }
        try await wait({ routes.save.calls == 1 }, "the old account's held autosave")
        routes.store.bindAccount("different-synthetic-owner")
        routes.save.complete(true)
        #expect(!(await navigating.value))
        #expect(routes.selectedNoteID == "original-note")
        #expect(routes.save.calls == 1)
    }

    @Test("A cancelled held request cannot commit its route")
    func cancellationDuringDeparture() async throws {
        let routes = Routes()
        defer { routes.save.complete(false) }
        let request = routes.begin()
        let navigating = Task {
            await routes.perform(request) { routes.selectedNoteID = "cancelled-note" }
        }
        defer { navigating.cancel() }
        try await wait({ routes.save.calls == 1 }, "the cancelled route's held autosave")
        navigating.cancel()
        routes.save.complete(true)
        #expect(!(await navigating.value))
        #expect(routes.selectedNoteID == "original-note")
    }

    @Test("A current pending note opens only after successful departure")
    func currentPendingNoteOpens() async throws {
        let routes = Routes()
        defer { routes.save.complete(false) }
        routes.pendingNoteID = "pending-note"
        let request = routes.current()
        let navigating = Task {
            await routes.perform(request) {
                guard routes.pendingNoteID == "pending-note" else { return }
                routes.selectedNoteID = "pending-note"
                routes.pendingNoteID = nil
            }
        }
        defer { navigating.cancel() }
        try await wait({ routes.save.calls == 1 }, "the pending note's held autosave")
        #expect(routes.selectedNoteID == "original-note")
        #expect(routes.pendingNoteID == "pending-note")
        routes.save.complete(true)
        #expect(await navigating.value)
        #expect(routes.selectedNoteID == "pending-note")
        #expect(routes.pendingNoteID == nil)
    }

    @Test("A replaced pending payload is checked again inside the guarded action")
    func replacedPendingPayloadIsNotConsumed() async throws {
        let routes = Routes()
        defer { routes.save.complete(false) }
        routes.pendingNoteID = "first-pending-note"
        let request = routes.current()
        let navigating = Task {
            await routes.perform(request) {
                guard routes.pendingNoteID == "first-pending-note" else { return }
                routes.selectedNoteID = "first-pending-note"
                routes.pendingNoteID = nil
            }
        }
        defer { navigating.cancel() }
        try await wait({ routes.save.calls == 1 }, "the first pending note's held autosave")
        routes.pendingNoteID = "replacement-note"
        routes.save.complete(true)
        #expect(await navigating.value, "The request remains current; its payload guard declines the action")
        #expect(routes.selectedNoteID == "original-note")
        #expect(routes.pendingNoteID == "replacement-note")
    }

    @Test("A failed save keeps the current editor selected")
    func failedDepartureDoesNotNavigate() async throws {
        let routes = Routes()
        defer { routes.save.complete(false) }
        let request = routes.begin()
        let navigating = Task {
            await routes.perform(request) { routes.selectedNoteID = "other-note" }
        }
        defer { navigating.cancel() }
        try await wait({ routes.save.calls == 1 }, "the failed held autosave")
        routes.save.complete(false)
        #expect(!(await navigating.value))
        #expect(routes.selectedNoteID == "original-note")
        #expect(routes.checks[request.intentID] == 1, "A failed save cannot reach the action")
    }
}
