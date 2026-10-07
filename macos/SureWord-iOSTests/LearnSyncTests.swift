import Foundation
import XCTest

@testable import SureWord

/// `LearnSyncStore`: a port of `mobile/src/features/learn/learnSync.test.ts`,
/// every case, same fixtures. The storage double can fail or hold any single
/// write, which is how the durability rules (receipt persisted before the
/// operation leaves; nothing sent when the enqueue write fails; one account's
/// work serialised across a remount) are exercised.
@MainActor
final class LearnSyncTests: XCTestCase {
    // MARK: - Doubles

    @MainActor
    final class Gate {
        private(set) var isOpen = false
        private var waiters: [CheckedContinuation<Void, Never>] = []

        func wait() async {
            if isOpen { return }
            await withCheckedContinuation { waiters.append($0) }
        }

        func open() {
            isOpen = true
            let pending = waiters
            waiters = []
            for waiter in pending { waiter.resume() }
        }
    }

    @MainActor
    final class MemoryStorage: LearnStorage {
        var values: [String: String] = [:]
        var writes = 0
        var failWrites: Set<Int> = []
        private var started: [Int: Gate] = [:]
        private var released: [Int: Gate] = [:]

        func getItem(_ key: String) async throws -> String? { values[key] }

        func setItem(_ key: String, _ value: String) async throws {
            writes += 1
            let write = writes
            started[write]?.open()
            await released[write]?.wait()
            if failWrites.contains(write) { throw URLError(.cannotCreateFile) }
            values[key] = value
        }

        /// Hold the next write until `release`; `started` opens when it begins.
        func blockNextWrite() -> (started: Gate, release: Gate) {
            let write = writes + 1
            let started = Gate()
            let release = Gate()
            self.started[write] = started
            released[write] = release
            return (started, release)
        }
    }

    static let reviewedAt = "2026-09-12T18:00:00.000Z"
    static let timezone = "America/Los_Angeles"

    static func card(_ id: String, revision: Int = 0, stage: Int = 0) -> LearnCard {
        LearnCard(
            id: id,
            revision: revision,
            book: id == "a" ? 43 : 45,
            chapter: id == "a" ? 3 : 8,
            verse: id == "a" ? 16 : 28,
            translation: "KJV",
            reference: id == "a" ? "John 3:16" : "Romans 8:28",
            text: id == "a" ? "For God so loved the world" : "And we know that all things work together for good",
            stage: stage,
            intervalDays: 0,
            dueAt: "2026-09-12T07:00:00.000Z",
            knownAt: nil
        )
    }

    static func today(_ cards: [LearnCard]) -> LearnToday {
        LearnToday(cards: cards, knownCount: 0, queueCount: cards.count)
    }

    static func acknowledgement(_ before: LearnCard, _ payload: LearnReviewOperation, replayed: Bool = false) -> LearnReviewAcknowledgement {
        LearnReviewAcknowledgement(
            operationId: payload.operationId,
            appliedRevision: payload.expectedRevision + 1,
            replayed: replayed,
            currentCard: LearnSync.predictReview(
                before,
                result: payload.result,
                reviewedAt: payload.reviewedAt,
                timezone: payload.timezone
            )
        )
    }

    @MainActor
    final class Harness {
        let store: LearnSyncStore
        let storage: MemoryStorage
        var serverToday: LearnToday
        var sends: [(cardId: String, payload: LearnReviewOperation)] = []

        init(
            userID: String = "user-a",
            storage: MemoryStorage = MemoryStorage(),
            serverToday: LearnToday = LearnSyncTests.today([LearnSyncTests.card("a"), LearnSyncTests.card("b")]),
            send: (@MainActor (Harness, String, LearnReviewOperation) async throws -> LearnReviewAcknowledgement)? = nil,
            fetch: (@MainActor () async throws -> LearnToday)? = nil,
            now: Date = LearnTime.parse(LearnSyncTests.reviewedAt)!,
            timezone: String = LearnSyncTests.timezone
        ) {
            self.storage = storage
            self.serverToday = serverToday
            var uuid = 0
            var me: Harness?
            let defaultSend: @MainActor (Harness, String, LearnReviewOperation) async throws -> LearnReviewAcknowledgement = { harness, cardId, payload in
                guard let before = harness.serverToday.cards.first(where: { $0.id == cardId }) else {
                    throw LearnReviewFailure(message: "missing", code: .missing)
                }
                let receipt = LearnSyncTests.acknowledgement(before, payload)
                harness.serverToday.cards = harness.serverToday.cards.map { $0.id == cardId ? receipt.currentCard! : $0 }
                return receipt
            }
            let send = send ?? defaultSend
            store = LearnSyncStore(userID: userID, dependencies: LearnSyncDependencies(
                storage: storage,
                fetchToday: {
                    if let fetch { return try await fetch() }
                    return me!.serverToday
                },
                sendReview: { cardId, payload in
                    me!.sends.append((cardId, payload))
                    return try await send(me!, cardId, payload)
                },
                createOperationID: {
                    uuid += 1
                    return String(format: "00000000-0000-4000-8000-%012d", uuid)
                },
                now: { now },
                timezone: { timezone }
            ))
            me = self
        }

        func hydrateWithToday() async throws {
            try await store.hydrate()
            try await store.installToday(serverToday)
        }
    }

    private func waitUntil(_ condition: () -> Bool) async {
        for _ in 0..<500 where !condition() {
            await Task.yield()
        }
    }

    private func snapshot(_ harness: Harness) -> LearnSyncSnapshot { harness.store.getSnapshot() }

    // MARK: - Cases

    func testCanRestartItsSubscriptionLifecycleOnTheSameStore() async throws {
        let harness = Harness(serverToday: Self.today([Self.card("a")]))
        var first: [Int] = []
        let unsubscribe = harness.store.subscribe { first.append($0.pendingCount) }
        try await harness.hydrateWithToday()
        unsubscribe()
        harness.store.dispose()

        var remounted: [Int] = []
        harness.store.activate()
        let unsubscribeRemount = harness.store.subscribe { remounted.append($0.pendingCount) }
        try await harness.store.hydrate()
        try await harness.store.enqueue("a", result: .good)

        XCTAssertGreaterThan(first.count, 1)
        XCTAssertEqual(remounted.last, 1)
        unsubscribeRemount()
    }

    func testSerializesADelayedSameAccountWriteAcrossAnUnmountAndRemount() async throws {
        let storage = MemoryStorage()
        let first = Harness(userID: "same-user", storage: storage, serverToday: Self.today([Self.card("a")]))
        try await first.hydrateWithToday()
        let blocked = storage.blockNextWrite()
        let enqueue = Task { try await first.store.enqueue("a", result: .good) }
        await blocked.started.wait()
        first.store.dispose()

        let remounted = Harness(userID: "same-user", storage: storage, serverToday: Self.today([Self.card("a")]))
        let hydrate = Task { try await remounted.store.hydrate() }
        blocked.release.open()
        let payload = try await enqueue.value
        try await hydrate.value

        XCTAssertEqual(remounted.store.getSnapshot().pendingCount, 1)
        XCTAssertTrue(storage.values[LearnSync.storageKey("same-user")]?.contains(payload.operationId) == true)
    }

    func testDoesNotSendOrClaimAReviewWhenTheEnqueueWriteFails() async throws {
        let harness = Harness()
        try await harness.hydrateWithToday()
        harness.storage.failWrites.insert(harness.storage.writes + 1)

        do {
            try await harness.store.enqueue("a", result: .good)
            XCTFail("enqueue should throw")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("Nothing was sent"))
        }
        await harness.store.synchronize(refresh: false)

        XCTAssertEqual(harness.sends.count, 0)
        XCTAssertEqual(snapshot(harness).pendingCount, 0)
        XCTAssertEqual(snapshot(harness).today?.cards.first?.id, "a")
        XCTAssertEqual(snapshot(harness).today?.cards.first?.revision, 0)
        XCTAssertEqual(snapshot(harness).today?.cards.first?.stage, 0)
    }

    func testPersistsAnAcknowledgementBeforeRemovingItOrSendingADependentReview() async throws {
        let harness = Harness(serverToday: Self.today([Self.card("a")]))
        try await harness.hydrateWithToday()
        try await harness.store.enqueue("a", result: .good)
        try await harness.store.enqueue("a", result: .good)
        // The next write stores the first receipt; the removal after it fails,
        // which models the process exiting once the receipt is durable.
        harness.storage.failWrites.insert(harness.storage.writes + 2)
        await harness.store.synchronize(refresh: false)

        XCTAssertEqual(harness.sends.map(\.payload.expectedRevision), [0])
        XCTAssertEqual(snapshot(harness).pendingCount, 2)

        harness.storage.failWrites.removeAll()
        let resumed = Harness(storage: harness.storage, serverToday: harness.serverToday)
        try await resumed.store.hydrate()
        await resumed.store.synchronize(refresh: false)

        XCTAssertEqual(resumed.sends.map(\.payload.expectedRevision), [1])
        XCTAssertEqual(snapshot(resumed).pendingCount, 0)
        XCTAssertEqual(snapshot(resumed).today?.cards.first?.revision, 2)
        XCTAssertEqual(snapshot(resumed).today?.cards.first?.stage, 2)
    }

    func testReplaysEachCardInRevisionOrder() async throws {
        let harness = Harness()
        try await harness.hydrateWithToday()
        try await harness.store.enqueue("a", result: .good)
        try await harness.store.enqueue("a", result: .good)
        try await harness.store.enqueue("b", result: .good)

        let cards = snapshot(harness).today?.cards ?? []
        XCTAssertEqual(cards.map(\.id), ["a", "b"])
        XCTAssertEqual(cards.map(\.revision), [2, 1])
        XCTAssertEqual(cards.map(\.stage), [2, 1])
        await harness.store.synchronize(refresh: false)

        XCTAssertEqual(harness.sends.map { "\($0.cardId)\($0.payload.expectedRevision)" }, ["a0", "a1", "b0"])
        XCTAssertEqual(snapshot(harness).pendingCount, 0)
    }

    func testBlocksDependentReviewsOnConflictWhileAnIndependentCardContinues() async throws {
        let currentA = Self.card("a", revision: 5, stage: 2)
        let harness = Harness(send: { _, cardId, payload in
            if cardId == "a" {
                throw LearnReviewFailure(message: "revision_conflict", code: .revisionConflict, currentCard: currentA)
            }
            return LearnSyncTests.acknowledgement(LearnSyncTests.card("b"), payload)
        })
        try await harness.hydrateWithToday()
        try await harness.store.enqueue("a", result: .good)
        try await harness.store.enqueue("a", result: .good)
        try await harness.store.enqueue("b", result: .good)

        await harness.store.synchronize(refresh: false)

        XCTAssertEqual(harness.sends.map { "\($0.cardId)\($0.payload.expectedRevision)" }, ["a0", "b0"])
        XCTAssertEqual(snapshot(harness).conflicts.map(\.cardId), ["a"])
        XCTAssertEqual(snapshot(harness).conflicts.first?.code, .revisionConflict)
        XCTAssertEqual(snapshot(harness).pendingCount, 2)

        harness.serverToday = Self.today([currentA, Self.card("b", revision: 1, stage: 1)])
        try await harness.store.useLatestSchedule("a")
        XCTAssertEqual(snapshot(harness).pendingCount, 0)
        XCTAssertEqual(snapshot(harness).today?.cards.first?.id, "a")
        XCTAssertEqual(snapshot(harness).today?.cards.first?.revision, 5)
        XCTAssertEqual(snapshot(harness).today?.cards.first?.stage, 2)
    }

    func testKeepsAReusedIDConflictUntilLatestScheduleRecoverySucceeds() async throws {
        var fetchFails = true
        let harness = Harness(
            serverToday: Self.today([Self.card("a")]),
            send: { _, _, _ in
                throw LearnReviewFailure(message: "operation_id_reused", code: .operationIdReused, currentCard: nil)
            },
            fetch: {
                if fetchFails { throw LearnReviewFailure(message: "offline", offline: true) }
                return LearnSyncTests.today([])
            }
        )
        try await harness.store.hydrate()
        try await harness.store.installToday(Self.today([Self.card("a")]))
        try await harness.store.enqueue("a", result: .good)
        await harness.store.synchronize(refresh: false)

        try await harness.store.useLatestSchedule("a")
        XCTAssertEqual(snapshot(harness).pendingCount, 1)
        XCTAssertEqual(snapshot(harness).connection, .offline)

        fetchFails = false
        try await harness.store.useLatestSchedule("a")
        XCTAssertEqual(snapshot(harness).pendingCount, 0)
        XCTAssertEqual(snapshot(harness).conflicts, [])
        XCTAssertEqual(snapshot(harness).downloadedCards, [])
    }

    func testRetriesALostResponseWithTheExactOperationAndAcceptsTheDuplicateReceipt() async throws {
        var applied: LearnReviewAcknowledgement?
        var firstPayload: LearnReviewOperation?
        var calls = 0
        let harness = Harness(serverToday: Self.today([Self.card("a")]), send: { _, _, payload in
            calls += 1
            guard let receipt = applied else {
                firstPayload = payload
                applied = LearnSyncTests.acknowledgement(LearnSyncTests.card("a"), payload)
                throw LearnReviewFailure(message: "connection lost", offline: true)
            }
            XCTAssertEqual(payload, firstPayload)
            var replay = receipt
            replay.replayed = true
            return replay
        })
        try await harness.hydrateWithToday()
        try await harness.store.enqueue("a", result: .good)

        await harness.store.synchronize(refresh: false)
        XCTAssertEqual(snapshot(harness).connection, .offline)
        XCTAssertEqual(snapshot(harness).pendingCount, 1)
        await harness.store.synchronize(refresh: false)

        XCTAssertEqual(calls, 2)
        XCTAssertEqual(harness.sends[1].payload, harness.sends[0].payload)
        XCTAssertEqual(snapshot(harness).pendingCount, 0)
        XCTAssertEqual(snapshot(harness).today?.cards.first?.revision, 1)
        XCTAssertEqual(snapshot(harness).today?.cards.first?.stage, 1)
    }

    func testIsolatesPersistedSessionsAndIgnoresAnOldAccountsLateResult() async throws {
        let storage = MemoryStorage()
        let gate = Gate()
        let first = Harness(userID: "user-a", storage: storage, serverToday: Self.today([Self.card("a")]), send: { _, _, payload in
            await gate.wait()
            return LearnSyncTests.acknowledgement(LearnSyncTests.card("a"), payload)
        })
        try await first.hydrateWithToday()
        let payload = try await first.store.enqueue("a", result: .good)
        let oldSync = Task { await first.store.synchronize(refresh: false) }
        await waitUntil { first.sends.count == 1 }
        XCTAssertEqual(first.sends.count, 1)
        first.store.dispose()

        let second = Harness(userID: "user-b", storage: storage, serverToday: Self.today([Self.card("b")]))
        try await second.hydrateWithToday()
        gate.open()
        await oldSync.value

        XCTAssertNotEqual(LearnSync.storageKey("user-a"), LearnSync.storageKey("user-b"))
        XCTAssertEqual(snapshot(second).pendingCount, 0)
        XCTAssertEqual(snapshot(second).today?.cards.first?.id, "b")
        XCTAssertEqual(snapshot(second).today?.cards.first?.revision, 0)
        XCTAssertTrue(storage.values[LearnSync.storageKey("user-a")]?.contains(payload.operationId) == true)
    }

    func testUsesAReceiptsNewerCurrentCardWithoutChangingAQueuedPayload() async throws {
        let newer = Self.card("a", revision: 3, stage: 3)
        let harness = Harness(serverToday: Self.today([Self.card("a")]), send: { _, _, payload in
            LearnReviewAcknowledgement(operationId: payload.operationId, appliedRevision: 1, replayed: true, currentCard: newer)
        })
        try await harness.hydrateWithToday()
        try await harness.store.enqueue("a", result: .good)

        await harness.store.synchronize(refresh: false)

        XCTAssertEqual(snapshot(harness).today?.cards.first?.revision, 3)
        XCTAssertEqual(snapshot(harness).today?.cards.first?.stage, 3)
        XCTAssertEqual(snapshot(harness).pendingCount, 0)
    }

    func testDoesNotSendADependentReviewAfterAReceiptReportsANewerRevision() async throws {
        let newer = Self.card("a", revision: 3, stage: 3)
        var calls = 0
        let harness = Harness(serverToday: Self.today([Self.card("a")]), send: { _, _, payload in
            calls += 1
            return LearnReviewAcknowledgement(operationId: payload.operationId, appliedRevision: 1, replayed: true, currentCard: newer)
        })
        try await harness.hydrateWithToday()
        try await harness.store.enqueue("a", result: .good)
        try await harness.store.enqueue("a", result: .good)

        await harness.store.synchronize(refresh: false)

        XCTAssertEqual(calls, 1)
        XCTAssertEqual(snapshot(harness).pendingCount, 1)
        XCTAssertEqual(
            snapshot(harness).conflicts,
            [LearnConflictView(cardId: "a", reference: "John 3:16", code: .revisionConflict, operationCount: 1)]
        )
    }

    func testRemovesANewerDeferredReceiptEvenWhenTheFollowingRefreshIsOffline() async throws {
        var newerTomorrow = Self.card("a", revision: 3, stage: 3)
        newerTomorrow.intervalDays = 1
        newerTomorrow.dueAt = "2026-09-13T07:00:00.000Z"
        let harness = Harness(
            serverToday: Self.today([Self.card("a")]),
            send: { _, _, payload in
                LearnReviewAcknowledgement(operationId: payload.operationId, appliedRevision: 1, replayed: true, currentCard: newerTomorrow)
            },
            fetch: { throw LearnReviewFailure(message: "offline", offline: true) }
        )
        try await harness.store.hydrate()
        try await harness.store.installToday(Self.today([Self.card("a")]))
        try await harness.store.enqueue("a", result: .good)

        await harness.store.synchronize()

        XCTAssertEqual(snapshot(harness).connection, .offline)
        XCTAssertEqual(snapshot(harness).pendingCount, 0)
        XCTAssertEqual(snapshot(harness).today?.cards, [])
        XCTAssertEqual(snapshot(harness).downloadedCards.first?.id, "a")
        XCTAssertEqual(snapshot(harness).downloadedCards.first?.revision, 3)
    }

    func testKeepsACompletedCardOutTodayAndRestoresItFromCacheTomorrowOffline() async throws {
        let storage = MemoryStorage()
        let recall = Self.card("a", stage: 3)
        let first = Harness(
            userID: "rollover-user",
            storage: storage,
            serverToday: Self.today([recall]),
            now: LearnTime.parse("2026-09-12T18:00:00.000Z")!
        )
        try await first.hydrateWithToday()
        try await first.store.enqueue("a", result: .good)
        await first.store.synchronize(refresh: false)

        XCTAssertEqual(snapshot(first).today?.cards, [])
        XCTAssertEqual(snapshot(first).downloadedCards.first?.id, "a")
        XCTAssertEqual(snapshot(first).downloadedCards.first?.revision, 1)
        XCTAssertEqual(snapshot(first).downloadedCards.first?.dueAt, "2026-09-13T07:00:00.000Z")
        first.store.dispose()

        let tomorrow = Harness(
            userID: "rollover-user",
            storage: storage,
            serverToday: Self.today([]),
            fetch: { throw LearnReviewFailure(message: "offline", offline: true) },
            now: LearnTime.parse("2026-09-13T18:00:00.000Z")!
        )
        try await tomorrow.store.hydrate()

        let card = snapshot(tomorrow).today?.cards.first
        XCTAssertEqual(card?.id, "a")
        XCTAssertEqual(card?.revision, 1)
        XCTAssertEqual(card?.stage, 3)
    }

    func testRestoresTomorrowsPredictedCardWithoutChangingItsPendingOperation() async throws {
        let storage = MemoryStorage()
        let recall = Self.card("a", stage: 3)
        let first = Harness(
            userID: "pending-rollover-user",
            storage: storage,
            serverToday: Self.today([recall]),
            now: LearnTime.parse("2026-09-12T18:00:00.000Z")!
        )
        try await first.hydrateWithToday()
        let payload = try await first.store.enqueue("a", result: .good)
        XCTAssertEqual(snapshot(first).today?.cards, [])
        first.store.dispose()

        let tomorrow = Harness(
            userID: "pending-rollover-user",
            storage: storage,
            serverToday: Self.today([]),
            now: LearnTime.parse("2026-09-13T18:00:00.000Z")!
        )
        try await tomorrow.store.hydrate()

        XCTAssertEqual(snapshot(tomorrow).pendingCount, 1)
        let card = snapshot(tomorrow).today?.cards.first
        XCTAssertEqual(card?.id, "a")
        XCTAssertEqual(card?.revision, 1)
        XCTAssertEqual(card?.stage, 3)
        XCTAssertTrue(storage.values[LearnSync.storageKey("pending-rollover-user")]?.contains(payload.operationId) == true)
    }

    func testPredictsTheNextLocalMidnightAcrossTheFallDSTBoundary() {
        let predicted = LearnSync.predictReview(
            Self.card("a", stage: 3),
            result: .good,
            reviewedAt: "2026-11-01T08:30:00.000Z",
            timezone: "America/Los_Angeles"
        )
        XCTAssertEqual(predicted.dueAt, "2026-11-02T08:00:00.000Z")
    }

    func testPredictsTheLadderAndTheResetWithoutTheServer() {
        let reviewedAt = Self.reviewedAt
        let up = LearnSync.predictReview(Self.card("a"), result: .good, reviewedAt: reviewedAt, timezone: Self.timezone)
        XCTAssertEqual(up.stage, 1)
        XCTAssertEqual(up.revision, 1)
        XCTAssertEqual(up.dueAt, "2026-09-12T07:00:00.000Z")
        let reset = LearnSync.predictReview(Self.card("a", stage: 3), result: .again, reviewedAt: reviewedAt, timezone: Self.timezone)
        XCTAssertEqual(reset.stage, 1)
        XCTAssertEqual(reset.intervalDays, 0)
        var long = Self.card("a", stage: 3)
        long.intervalDays = 8
        let known = LearnSync.predictReview(long, result: .good, reviewedAt: reviewedAt, timezone: Self.timezone)
        XCTAssertEqual(known.intervalDays, 16)
        XCTAssertEqual(known.knownAt, reviewedAt)
        XCTAssertEqual(known.dueAt, "2026-09-28T07:00:00.000Z")
    }

    func testAcceptsAReplayReceiptWhoseCardWasDeletedAfterTheReview() async throws {
        let harness = Harness(serverToday: Self.today([Self.card("a")]), send: { _, _, payload in
            LearnReviewAcknowledgement(operationId: payload.operationId, appliedRevision: 1, replayed: true, currentCard: nil)
        })
        try await harness.hydrateWithToday()
        try await harness.store.enqueue("a", result: .good)

        await harness.store.synchronize(refresh: false)

        XCTAssertEqual(snapshot(harness).pendingCount, 0)
        XCTAssertEqual(snapshot(harness).today?.cards, [])
        XCTAssertEqual(snapshot(harness).downloadedCards, [])
    }

    func testOperationIDsMustBeUUIDs() {
        XCTAssertTrue(LearnSync.isOperationID("00000000-0000-4000-8000-000000000001"))
        XCTAssertTrue(LearnSync.isOperationID(UUID().uuidString.lowercased()))
        XCTAssertFalse(LearnSync.isOperationID("not-a-uuid"))
        XCTAssertFalse(LearnSync.isOperationID("00000000-0000-9000-8000-000000000001"))
        XCTAssertFalse(LearnSync.isOperationID("00000000-0000-4000-c000-000000000001"))
    }
}
