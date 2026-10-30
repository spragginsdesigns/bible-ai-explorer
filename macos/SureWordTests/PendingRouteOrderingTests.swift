import Foundation
import Testing
@testable import SureWord

/// Isolated sessions exercise the shipping queue and payload seams with the
/// real departure coordinator. No AppModel/account/auth initialization.
@Suite("Pending route ownership", .serialized)
@MainActor
struct PendingRouteOrderingTests {
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
    private final class Session {
        let queue = PendingDeepLinks(center: NotificationCenter())
        let store = NotesStore(cacheURL: nil, allowsEphemeralLedger: true)
        let departure = NoteDepartureCoordinator()
        let save = HeldSave()
        let ownerID = UUID()
        private var intentID = UUID()
        private(set) var minted = 0

        init() {
            store.bindAccount("synthetic-route-owner")
            let save = self.save
            departure.register(owner: UUID()) { await save.flush() }
        }

        func begin() -> AppModel.NoteNavigationRequest {
            minted += 1
            intentID = UUID()
            queue.invalidateDelayedArrivals()
            return AppModel.NoteNavigationRequest(intentID: intentID, epoch: store.epoch)
        }

        func isCurrent(_ request: AppModel.NoteNavigationRequest) -> Bool {
            !Task.isCancelled && request.intentID == intentID && store.isCurrent(request.epoch)
        }
    }

    private func wait(_ condition: @MainActor () -> Bool, _ reason: String, sourceLocation: SourceLocation = #_sourceLocation) async throws {
        let deadline = ContinuousClock.now + .seconds(4)
        while !condition(), ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(5))
        }
        try #require(condition(), "Timed out waiting for \(reason)", sourceLocation: sourceLocation)
    }

    @Test("A queued link adopted before a held save cannot become a fresh intent after a newer row")
    func queuedLinkCannotRenewAfterDeparture() async throws {
        let session = Session()
        defer { session.save.complete(false) }
        let event = session.queue.post(.verse("John 3:16"))
        let delivery = try #require(session.queue.adopt(event, ownerID: session.ownerID) { session.begin() })
        var opened: DeepLink?
        let navigating = Task {
            await session.queue.perform(delivery, isCurrent: session.isCurrent, departure: session.departure) {
                opened = $0
                return true
            }
        }
        defer { navigating.cancel() }
        try await wait({ session.save.calls == 1 }, "the old queued link's departure")
        _ = session.begin() // A later explicit row or Back intent.
        session.save.complete(true)
        #expect(!(await navigating.value))
        #expect(opened == nil)
        #expect(session.queue.events.isEmpty)
        #expect(session.minted == 2)
        #expect(session.queue.adopt(event, ownerID: session.ownerID) { session.begin() } == nil)
        #expect(session.minted == 2, "A stale event must not manufacture another intent")
    }

    @Test("A failed save keeps the queued event and retries its original request")
    func failedSaveRetainsOriginalDelivery() async throws {
        let session = Session()
        defer { session.save.complete(false) }
        let event = session.queue.post(.cross)
        let delivery = try #require(session.queue.adopt(event, ownerID: session.ownerID) { session.begin() })
        var actions = 0
        let first = Task {
            await session.queue.perform(delivery, isCurrent: session.isCurrent, departure: session.departure) { _ in
                actions += 1
                return true
            }
        }
        defer { first.cancel() }
        try await wait({ session.save.calls == 1 }, "the refused departure")
        session.save.complete(false)
        #expect(!(await first.value))
        #expect(session.queue.events == [event])
        #expect(actions == 0)
        let retry = try #require(session.queue.adopt(event, ownerID: session.ownerID, allowNewIntent: false) { session.begin() })
        #expect(retry == delivery)
        #expect(session.minted == 1)
        let second = Task {
            await session.queue.perform(retry, isCurrent: session.isCurrent, departure: session.departure) { _ in
                actions += 1
                return true
            }
        }
        defer { second.cancel() }
        try await wait({ session.save.calls == 2 }, "the same request's retry")
        session.save.complete(true)
        #expect(await second.value)
        #expect(actions == 1)
        #expect(session.queue.events.isEmpty)
        #expect(session.minted == 1)
    }

    @Test("A declined invalid payload is retired after successful departure")
    func declinedActionDoesNotPoisonQueue() async throws {
        let session = Session()
        defer { session.save.complete(false) }
        let event = session.queue.post(.chat(""))
        let delivery = try #require(session.queue.adopt(event, ownerID: session.ownerID) { session.begin() })
        var triedAction = false
        let navigating = Task {
            await session.queue.perform(delivery, isCurrent: session.isCurrent, departure: session.departure) { _ in
                triedAction = true
                return false
            }
        }
        defer { navigating.cancel() }
        try await wait({ session.save.calls == 1 }, "the declined payload departure")
        #expect(!triedAction)
        session.save.complete(true)
        #expect(!(await navigating.value))
        #expect(triedAction)
        #expect(session.queue.events.isEmpty)
        #expect(session.minted == 1)
    }

    @Test("Live and startup adopters cannot duplicate or steal a claimed event")
    func ownerAndStartupIdentityAreStable() async throws {
        let session = Session()
        defer { session.save.complete(false) }
        let event = session.queue.post(.cross)
        let delivery = try #require(session.queue.adopt(event, ownerID: session.ownerID) { session.begin() })
        let again = session.queue.adopt(event, ownerID: session.ownerID, allowNewIntent: false) { session.begin() }
        #expect(again == delivery)
        #expect(session.queue.adopt(event, ownerID: UUID()) { session.begin() } == nil)
        #expect(session.minted == 1)
        #expect(session.queue.events == [event])
        let navigating = Task {
            await session.queue.perform(delivery, isCurrent: session.isCurrent, departure: session.departure) { _ in true }
        }
        defer { navigating.cancel() }
        try await wait({ session.save.calls == 1 }, "the original owner's departure")
        session.save.complete(true)
        #expect(await navigating.value)
        #expect(session.queue.events.isEmpty)
        #expect(session.queue.adopt(event, ownerID: session.ownerID) { session.begin() } == nil)
        #expect(session.minted == 1)
    }

    @Test("Startup cannot adopt an unclaimed cold event after a newer explicit choice")
    func startupYieldsWithoutMinting() {
        let session = Session()
        let event = session.queue.post(.cross)
        _ = session.begin()
        let rejected = session.queue.adopt(event, ownerID: session.ownerID, allowNewIntent: false) { session.begin() }
        #expect(rejected == nil)
        #expect(session.minted == 1)
        #expect(session.queue.events.isEmpty)
    }

    @Test("Session queue clearing and account epoch changes reject held deliveries", arguments: [false, true])
    func sessionBoundaryInvalidatesHeldDelivery(changeEpoch: Bool) async throws {
        let session = Session()
        defer { session.save.complete(false) }
        let event = session.queue.post(.cross)
        let delivery = try #require(session.queue.adopt(event, ownerID: session.ownerID) { session.begin() })
        var actions = 0
        let navigating = Task {
            await session.queue.perform(delivery, isCurrent: session.isCurrent, departure: session.departure) { _ in
                actions += 1
                return true
            }
        }
        defer { navigating.cancel() }
        try await wait({ session.save.calls == 1 }, "the old session departure")
        if changeEpoch { session.store.bindAccount("new-synthetic-owner") }
        else { #expect(session.queue.drain() == [.cross]) }
        session.save.complete(true)
        #expect(!(await navigating.value))
        #expect(actions == 0)
        #expect(session.queue.events.isEmpty)
    }

    @Test("An async native URL completion cannot publish after an explicit intent or session clear")
    func delayedArrivalCannotPublish() {
        let session = Session()
        let superseded = session.queue.prepare(.verse("John 3:16"))
        _ = session.begin()
        #expect(session.queue.post(superseded) == nil)
        let oldSession = session.queue.prepare(.cross)
        _ = session.queue.drain()
        #expect(session.queue.post(oldSession) == nil)
        let current = session.queue.prepare(.cross)
        #expect(session.queue.post(current) != nil)
        #expect(session.queue.post(current) == nil, "One arrival can publish only once")
        #expect(session.queue.events.count == 1)
    }

    @Test("A newer prepared arrival prevents startup from promoting an older cold link")
    func preparedNewArrivalWinsColdQueue() {
        let session = Session()
        let old = session.queue.post(.cross)
        let latest = session.queue.prepare(.verse("Psalm 23:1"))
        #expect(session.queue.adopt(old, ownerID: session.ownerID) { session.begin() } == nil)
        #expect(session.minted == 0)
        let posted = session.queue.post(latest)
        #expect(posted?.link == .verse("Psalm 23:1"))
        #expect(session.queue.events.count == 1)
    }

    @Test("A same-section Study payload cannot replace Notes until departure succeeds")
    func studyPayloadRequiresSuccessfulDeparture() async throws {
        let session = Session()
        defer { session.save.complete(false) }
        let request = session.begin()
        let route = AppModel.PendingDestination(request: request, value: StudyHubDestination.timeline)
        var pending: AppModel.PendingDestination<StudyHubDestination>? = route
        var path: [StudyHubDestination] = [.notes]
        let navigating = Task {
            await route.perform(isCurrent: { session.isCurrent(request) && pending == route }, departure: session.departure) {
                path = [$0]
                pending = nil
            }
        }
        defer { navigating.cancel() }
        try await wait({ session.save.calls == 1 }, "the same-section Study departure")
        #expect(path == [.notes])
        session.save.complete(false)
        #expect(!(await navigating.value))
        #expect(path == [.notes])
        #expect(pending == route)
    }

    @Test("A replaced pending payload is not applied or cleared by an older consumer")
    func replacedEnvelopeSurvivesOldConsumer() async throws {
        let session = Session()
        defer { session.save.complete(false) }
        let request = session.begin()
        let route = AppModel.PendingDestination(request: request, value: DailyWalkDestination.plan)
        let replacement = AppModel.PendingDestination(request: request, value: DailyWalkDestination.history)
        var pending: AppModel.PendingDestination<DailyWalkDestination>? = route
        var selected: DailyWalkDestination?
        let navigating = Task {
            await route.perform(isCurrent: { session.isCurrent(request) && pending == route }, departure: session.departure) {
                selected = $0
                pending = nil
            }
        }
        defer { navigating.cancel() }
        try await wait({ session.save.calls == 1 }, "the original pending consumer")
        pending = replacement
        session.save.complete(true)
        #expect(!(await navigating.value))
        #expect(selected == nil)
        #expect(pending == replacement)
    }

    @Test("Latest verse and nil translation stay paired across a coalesced departure")
    func versePayloadCannotMixTranslations() async throws {
        let session = Session()
        defer { session.save.complete(false) }
        let firstRequest = session.begin()
        let first = AppModel.PendingDestination(request: firstRequest,
            value: AppModel.VerseDestination(reference: "John 3:16", translation: .kjv))
        var pending: AppModel.PendingDestination<AppModel.VerseDestination>? = first
        var opened: AppModel.VerseDestination?
        let older = Task {
            await first.perform(isCurrent: { session.isCurrent(firstRequest) && pending == first }, departure: session.departure) {
                opened = $0
                pending = nil
            }
        }
        defer { older.cancel() }
        try await wait({ session.save.calls == 1 }, "the old translated verse")
        let lastRequest = session.begin()
        let last = AppModel.PendingDestination(request: lastRequest,
            value: AppModel.VerseDestination(reference: "Psalm 23:1", translation: nil))
        pending = last
        var joined = false
        let newer = Task {
            await last.perform(isCurrent: {
                joined = true
                return session.isCurrent(lastRequest) && pending == last
            }, departure: session.departure) {
                opened = $0
                pending = nil
            }
        }
        defer { newer.cancel() }
        try await wait({ joined }, "the latest unqualified verse joining the save")
        session.save.complete(true)
        #expect(!(await older.value))
        #expect(await newer.value)
        #expect(session.save.calls == 1)
        #expect(opened?.reference == "Psalm 23:1")
        #expect(opened?.translation == nil)
        #expect(pending == nil)
    }
}
