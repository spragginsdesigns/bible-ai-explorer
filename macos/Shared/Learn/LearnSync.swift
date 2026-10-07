import Foundation

/// The offline practice session and its review outbox - a port of
/// `mobile/src/features/learn/learnSync.ts` (`LearnSyncStore`), whose Vitest
/// suite is ported case for case into `SureWord-iOSTests/LearnSyncTests.swift`.
///
/// The contract, in short:
/// - A downloaded session (at most 3 practice cards, 6 cached) lives on the
///   device per account, so practice keeps working with no connection.
/// - Every review is written to a durable outbox *before* anything is sent, and
///   carries the card revision it was made against (`expectedRevision`) and a
///   client-made operation id, so a retried request is a replay, never a
///   second review.
/// - Reviews of one card are sent in revision order; a conflict on a card
///   blocks only that card's later reviews, never another card's.
/// - A receipt is persisted before its operation is removed or a dependent
///   review is sent.
/// - All work for one account is serialised, even across store instances (a
///   screen that unmounts and remounts mid-write).
///
/// **If you change one side, change both.**

enum LearnConflictCode: String, Codable, Sendable, Equatable {
    case revisionConflict = "revision_conflict"
    case operationIdReused = "operation_id_reused"
    case missing
}

enum LearnConnection: String, Sendable, Equatable {
    case initializing, idle, syncing, offline, error
}

struct LearnReviewFailure: Error, Equatable, LocalizedError {
    let message: String
    var code: LearnConflictCode?
    var currentCard: LearnCard?
    var offline = false

    var errorDescription: String? { message }
}

/// Async key-value storage for the persisted session - AsyncStorage on
/// Android, `UserDefaults` here (see `LearnDefaultsStorage`).
@MainActor
protocol LearnStorage: AnyObject {
    func getItem(_ key: String) async throws -> String?
    func setItem(_ key: String, _ value: String) async throws
}

/// Production storage. `UserDefaults` is synchronous, which is fine: the
/// session is a few kilobytes and every write is already serialised.
@MainActor
final class LearnDefaultsStorage: LearnStorage {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func getItem(_ key: String) async throws -> String? {
        defaults.string(forKey: key)
    }

    func setItem(_ key: String, _ value: String) async throws {
        defaults.set(value, forKey: key)
    }
}

struct LearnConflictView: Equatable, Sendable {
    let cardId: String
    let reference: String
    let code: LearnConflictCode
    let operationCount: Int
}

struct LearnSyncSnapshot: Equatable, Sendable {
    var hydrated: Bool
    var today: LearnToday?
    var downloadedCards: [LearnCard]
    var pendingCount: Int
    var conflicts: [LearnConflictView]
    var connection: LearnConnection
    var message: String?
}

@MainActor
struct LearnSyncDependencies {
    var storage: any LearnStorage
    var fetchToday: @MainActor () async throws -> LearnToday
    var sendReview: @MainActor (_ cardId: String, _ payload: LearnReviewOperation) async throws -> LearnReviewAcknowledgement
    var createOperationID: @MainActor () -> String
    var now: @MainActor () -> Date
    var timezone: @MainActor () -> String
}

// MARK: - Persisted state

private struct StoredConflict: Codable, Equatable {
    var code: LearnConflictCode
    var currentCard: LearnCard?

    private enum CodingKeys: String, CodingKey { case code, currentCard }

    init(code: LearnConflictCode, currentCard: LearnCard?) {
        self.code = code
        self.currentCard = currentCard
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(LearnConflictCode.self, forKey: .code)
        currentCard = try c.decodeIfPresent(LearnCard.self, forKey: .currentCard)
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(code, forKey: .code)
        try c.encode(currentCard, forKey: .currentCard)
    }
}

private struct StoredReview: Codable, Equatable {
    enum Status: String, Codable { case pending, acknowledged, conflict }

    var cardId: String
    var payload: LearnReviewOperation
    var before: LearnCard
    var predicted: LearnCard
    var completesSessionCard: Bool
    var status: Status
    var acknowledgement: LearnReviewAcknowledgement?
    var conflict: StoredConflict?

    /// `parseStoredReview`'s chain checks.
    func validate() throws {
        let invalid = LearnParseError(message: "Invalid stored Learn outbox")
        guard !cardId.isEmpty else { throw invalid }
        guard LearnSync.isOperationID(payload.operationId),
              payload.expectedRevision >= 0,
              LearnTime.parse(payload.reviewedAt) != nil,
              LearnTime.validTimezone(payload.timezone) == payload.timezone
        else { throw invalid }
        try before.validate()
        try predicted.validate()
        guard before.id == cardId, predicted.id == cardId,
              payload.expectedRevision == before.revision,
              predicted.revision == before.revision + 1
        else { throw invalid }
        switch status {
        case .acknowledged:
            guard let acknowledgement else { throw invalid }
            try acknowledgement.validate(expectedOperationID: payload.operationId)
        case .conflict:
            guard conflict != nil else { throw invalid }
        case .pending:
            break
        }
    }
}

private struct PersistedLearnState: Codable, Equatable {
    var version: Int
    var ownerId: String
    var hasSnapshot: Bool
    var practiceDay: String
    var practiceTimezone: String
    var cards: [LearnCard]
    var practiceCardIds: [String]
    var knownCount: Int
    var queueCount: Int
    var outbox: [StoredReview]

    static func empty(_ userID: String) -> PersistedLearnState {
        PersistedLearnState(
            version: LearnSync.stateVersion,
            ownerId: userID,
            hasSnapshot: false,
            practiceDay: "",
            practiceTimezone: "",
            cards: [],
            practiceCardIds: [],
            knownCount: 0,
            queueCount: 0,
            outbox: []
        )
    }

    /// `parsePersistedState`.
    static func parse(_ raw: String, userID: String) throws -> PersistedLearnState {
        let invalid = LearnParseError(message: "Invalid stored Learn state")
        let value = try JSONDecoder().decode(PersistedLearnState.self, from: Data(raw.utf8))
        guard value.version == LearnSync.stateVersion, value.ownerId == userID,
              value.cards.count <= LearnSync.maxCachedCards,
              value.practiceCardIds.count <= 3,
              value.knownCount >= 0, value.queueCount >= 0,
              value.outbox.count <= LearnSync.maxOutboxOperations
        else { throw invalid }
        for card in value.cards { try card.validate() }
        let ids = value.cards.map(\.id)
        guard Set(ids).count == ids.count,
              value.practiceCardIds.allSatisfy(ids.contains),
              Set(value.practiceCardIds).count == value.practiceCardIds.count
        else { throw LearnParseError(message: "Invalid stored Learn cards") }
        for review in value.outbox { try review.validate() }
        return value
    }

    func serialized() throws -> String {
        String(decoding: try JSONEncoder().encode(self), as: UTF8.self)
    }
}

/// An insertion-ordered card map, standing in for the JS `Map` the TS store
/// leans on: `set` on an existing id keeps its position.
private struct OrderedCards {
    private(set) var values: [LearnCard] = []

    init(_ cards: [LearnCard]) {
        for card in cards { set(card) }
    }

    func get(_ id: String) -> LearnCard? { values.first { $0.id == id } }

    mutating func set(_ card: LearnCard) {
        if let index = values.firstIndex(where: { $0.id == card.id }) {
            values[index] = card
        } else {
            values.append(card)
        }
    }

    mutating func delete(_ id: String) { values.removeAll { $0.id == id } }
}

// MARK: - Pure rules

enum LearnSync {
    static let stateVersion = 3
    static let maxCachedCards = 6
    static let maxOutboxOperations = 100

    static func storageKey(_ userID: String) -> String {
        let encoded = userID.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? userID
        return "sureword:learn:v3:\(encoded)"
    }

    /// The UUID shape the route accepts for `operationId`.
    static func isOperationID(_ value: String) -> Bool {
        let parts = value.lowercased().split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 5, parts.map(\.count) == [8, 4, 4, 4, 12] else { return false }
        let hex = Set("0123456789abcdef")
        guard parts.allSatisfy({ $0.allSatisfy(hex.contains) }) else { return false }
        guard let version = parts[2].first, ("1"..."8").contains(version) else { return false }
        guard let variant = parts[3].first, "89ab".contains(variant) else { return false }
        return true
    }

    /// The schedule the server will compute for this review, so the practice
    /// session moves on before the review has been sent.
    static func predictReview(
        _ card: LearnCard,
        result: LearnResult,
        reviewedAt: String,
        timezone: String
    ) -> LearnCard {
        let instant = LearnTime.parse(reviewedAt) ?? Date()
        let zone = LearnTime.validTimezone(timezone)
        var stage = card.stage
        var intervalDays = card.intervalDays
        var dueInDays = 0
        if result == .again {
            stage = 1
            intervalDays = 0
        } else if card.stage < 3 {
            stage = card.stage + 1
        } else {
            intervalDays = max(1, card.intervalDays * 2)
            dueInDays = intervalDays
        }
        var next = card
        next.revision = card.revision + 1
        next.stage = stage
        next.intervalDays = intervalDays
        next.dueAt = LearnTime.format(LearnTime.startOfShiftedLocalDay(instant, timezone: zone, days: dueInDays))
        next.knownAt = card.knownAt ?? (intervalDays >= 16 ? reviewedAt : nil)
        return next
    }

    fileprivate static func projectedCards(_ state: PersistedLearnState) -> OrderedCards {
        var cards = OrderedCards(state.cards)
        for review in state.outbox {
            if review.status == .acknowledged {
                if let current = review.acknowledgement?.currentCard {
                    cards.set(Learn.preserveCardText(cards.get(review.cardId), current))
                } else {
                    cards.delete(review.cardId)
                }
            } else {
                cards.set(review.predicted)
            }
        }
        return cards
    }

    fileprivate static func activePracticeIDs(_ state: PersistedLearnState) -> [String] {
        var ids = state.practiceCardIds
        let cards = projectedCards(state)
        for review in state.outbox where review.completesSessionCard {
            let dueAfterPracticeDay: Bool
            if let current = cards.get(review.cardId), let due = LearnTime.parse(current.dueAt) {
                let zone = state.practiceTimezone.isEmpty ? "UTC" : state.practiceTimezone
                dueAfterPracticeDay = LearnTime.dayKey(due, timezone: LearnTime.validTimezone(zone)) > state.practiceDay
            } else {
                dueAfterPracticeDay = cards.get(review.cardId) == nil
            }
            guard dueAfterPracticeDay else { continue }
            ids.removeAll { $0 == review.cardId }
        }
        return ids
    }

    fileprivate static func rollPracticeDay(
        _ state: PersistedLearnState,
        now: Date,
        timezone: String
    ) -> PersistedLearnState {
        guard state.hasSnapshot else { return state }
        let zone = LearnTime.validTimezone(timezone)
        let day = LearnTime.dayKey(now, timezone: zone)
        if state.practiceDay == day && state.practiceTimezone == zone { return state }
        let conflicted = Set(state.outbox.filter { $0.status == .conflict }.map(\.cardId))
        let cachedOrder = Dictionary(
            state.cards.enumerated().map { ($1.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        let due = projectedCards(state).values
            .filter { !conflicted.contains($0.id) && !Learn.isCardDueAfterDay($0, instant: now, timezone: timezone) }
            .sorted { left, right in
                let leftDue = LearnTime.parse(left.dueAt) ?? .distantPast
                let rightDue = LearnTime.parse(right.dueAt) ?? .distantPast
                if leftDue != rightDue { return leftDue < rightDue }
                return (cachedOrder[left.id] ?? maxCachedCards) < (cachedOrder[right.id] ?? maxCachedCards)
            }
            .prefix(3)
        var next = state
        next.practiceDay = day
        next.practiceTimezone = zone
        next.practiceCardIds = due.map(\.id)
        return next
    }

    fileprivate static func snapshot(
        _ state: PersistedLearnState?,
        connection: LearnConnection,
        message: String?
    ) -> LearnSyncSnapshot {
        guard let state else {
            return LearnSyncSnapshot(
                hydrated: false,
                today: nil,
                downloadedCards: [],
                pendingCount: 0,
                conflicts: [],
                connection: connection,
                message: message
            )
        }
        let cards = projectedCards(state)
        let todayCards = activePracticeIDs(state).compactMap { cards.get($0) }
        let conflictedIDs = Set(state.outbox.filter { $0.status == .conflict }.map(\.cardId))
        var order: [String] = []
        var views: [String: LearnConflictView] = [:]
        for review in state.outbox where conflictedIDs.contains(review.cardId) {
            let conflict = review.status == .conflict
                ? review.conflict
                : state.outbox.first { $0.cardId == review.cardId && $0.status == .conflict }?.conflict
            guard let conflict else { continue }
            if views[review.cardId] == nil { order.append(review.cardId) }
            views[review.cardId] = LearnConflictView(
                cardId: review.cardId,
                reference: review.before.reference,
                code: conflict.code,
                operationCount: (views[review.cardId]?.operationCount ?? 0) + 1
            )
        }
        return LearnSyncSnapshot(
            hydrated: true,
            today: state.hasSnapshot
                ? LearnToday(cards: todayCards, knownCount: state.knownCount, queueCount: state.queueCount)
                : nil,
            downloadedCards: cards.values,
            pendingCount: state.outbox.count,
            conflicts: order.compactMap { views[$0] },
            connection: connection,
            message: message
        )
    }

    static func isOfflineError(_ error: any Error) -> Bool {
        if let failure = error as? LearnReviewFailure { return failure.offline }
        if let apiError = error as? APIError { return apiError.isOffline }
        if error is URLError { return true }
        return false
    }
}

// MARK: - The store

@MainActor
final class LearnSyncStore {
    private var state: PersistedLearnState?
    private var connection: LearnConnection = .initializing
    private var message: String?
    private var listeners: [UUID: (LearnSyncSnapshot) -> Void] = [:]
    private var disposed = false
    private let userID: String
    private let dependencies: LearnSyncDependencies

    /// One tail per storage key, shared by every store instance: the
    /// `accountWork` map in learnSync.ts.
    private static var accountTails: [String: Task<Void, Never>] = [:]

    init(userID: String, dependencies: LearnSyncDependencies) {
        self.userID = userID
        self.dependencies = dependencies
    }

    private var key: String { LearnSync.storageKey(userID) }

    func getSnapshot() -> LearnSyncSnapshot {
        LearnSync.snapshot(state, connection: connection, message: message)
    }

    @discardableResult
    func subscribe(_ listener: @escaping (LearnSyncSnapshot) -> Void) -> () -> Void {
        let id = UUID()
        listeners[id] = listener
        listener(getSnapshot())
        return { [weak self] in self?.listeners[id] = nil }
    }

    func dispose() {
        disposed = true
        listeners.removeAll()
    }

    /// A screen that reappears reuses its store.
    func activate() {
        disposed = false
    }

    private func publish() {
        guard !disposed else { return }
        let snapshot = getSnapshot()
        for listener in listeners.values { listener(snapshot) }
    }

    private func setConnection(_ connection: LearnConnection, _ message: String? = nil) {
        self.connection = connection
        self.message = message
        publish()
    }

    /// Run `work` after everything already queued for this account.
    private func exclusive<T: Sendable>(_ work: @escaping @MainActor @Sendable () async throws -> T) async throws -> T {
        let key = key
        let previous = Self.accountTails[key]
        let task = Task { @MainActor () async throws -> T in
            await previous?.value
            return try await work()
        }
        let tail = Task { @MainActor () -> Void in _ = try? await task.value }
        Self.accountTails[key] = tail
        defer {
            Task { @MainActor in
                await tail.value
                if Self.accountTails[key] == tail { Self.accountTails[key] = nil }
            }
        }
        return try await task.value
    }

    private func commit(_ next: PersistedLearnState) async throws {
        guard !disposed else { return }
        try await dependencies.storage.setItem(key, try next.serialized())
        guard !disposed else { return }
        state = next
        publish()
    }

    func hydrate() async throws {
        try await exclusive { [self] in
            guard !disposed else { return }
            do {
                let raw = try await dependencies.storage.getItem(key)
                var next = PersistedLearnState.empty(userID)
                if let raw {
                    do {
                        next = try PersistedLearnState.parse(raw, userID: userID)
                    } catch {
                        try await dependencies.storage.setItem(key, try next.serialized())
                    }
                }
                let rolled = LearnSync.rollPracticeDay(next, now: dependencies.now(), timezone: dependencies.timezone())
                if rolled != next {
                    try await dependencies.storage.setItem(key, try rolled.serialized())
                    next = rolled
                }
                if !disposed {
                    state = next
                    setConnection(.idle)
                }
            } catch {
                setConnection(.error, "Learn could not read its saved practice data on this device.")
                throw LearnParseError(message: "Learn storage is unavailable")
            }
        }
    }

    func installToday(_ value: LearnToday) async throws {
        try await exclusive { [self] in
            guard !disposed else { return }
            try value.validate()
            try await installTodayInside(value)
        }
    }

    private func installTodayInside(_ today: LearnToday) async throws {
        guard let state else { throw LearnParseError(message: "Learn has not hydrated") }
        try await commit(mergeToday(state, today))
    }

    private func mergeToday(_ state: PersistedLearnState, _ today: LearnToday) -> PersistedLearnState {
        let old = OrderedCards(state.cards)
        let incoming = today.cards.map { Learn.preserveCardText(old.get($0.id), $0) }
        let keep = Set(state.outbox.map(\.cardId) + state.practiceCardIds)
        let incomingIDs = Set(incoming.map(\.id))
        let retained = state.cards.filter { card in
            !incomingIDs.contains(card.id) && (keep.contains(card.id) || state.hasSnapshot)
        }
        let zone = LearnTime.validTimezone(dependencies.timezone())
        var next = state
        next.hasSnapshot = true
        next.practiceDay = LearnTime.dayKey(dependencies.now(), timezone: zone)
        next.practiceTimezone = zone
        next.cards = Array((incoming + retained).prefix(LearnSync.maxCachedCards))
        next.practiceCardIds = today.cards.map(\.id)
        next.knownCount = today.knownCount
        next.queueCount = today.queueCount
        return next
    }

    @discardableResult
    func enqueue(_ cardID: String, result: LearnResult) async throws -> LearnReviewOperation {
        try await exclusive { [self] () async throws -> LearnReviewOperation in
            guard !disposed else { throw LearnParseError(message: "Learn session is closed") }
            guard let state else { throw LearnParseError(message: "Learn has not hydrated") }
            guard state.outbox.count < LearnSync.maxOutboxOperations else {
                throw LearnParseError(message: "Sync saved reviews before continuing.")
            }
            guard let before = LearnSync.projectedCards(state).get(cardID),
                  LearnSync.activePracticeIDs(state).contains(cardID)
            else { throw LearnParseError(message: "This verse is no longer in the current practice session.") }
            let reviewedAt = LearnTime.format(dependencies.now())
            let timezone = LearnTime.validTimezone(dependencies.timezone())
            let operationID = dependencies.createOperationID()
            guard LearnSync.isOperationID(operationID) else {
                throw LearnParseError(message: "Could not create a safe review identifier.")
            }
            let payload = LearnReviewOperation(
                result: result,
                operationId: operationID,
                expectedRevision: before.revision,
                reviewedAt: reviewedAt,
                timezone: timezone
            )
            let review = StoredReview(
                cardId: cardID,
                payload: payload,
                before: before,
                predicted: LearnSync.predictReview(before, result: result, reviewedAt: reviewedAt, timezone: timezone),
                completesSessionCard: result == .good && before.stage == 3,
                status: .pending
            )
            var next = state
            next.outbox.append(review)
            do {
                try await commit(next)
                setConnection(connection == .initializing ? .idle : connection)
                return payload
            } catch {
                setConnection(.error, "This review was not saved on the device and was not sent.")
                throw LearnParseError(message: "Could not save this review on the device. Nothing was sent.")
            }
        }
    }

    func synchronize(refresh: Bool = true) async {
        _ = try? await exclusive { [self] in
            guard !disposed else { return }
            await synchronizeInside(refresh: refresh)
        }
    }

    private func synchronizeInside(refresh: Bool) async {
        guard state != nil, !disposed else { return }
        setConnection(.syncing)
        do {
            let rolled = LearnSync.rollPracticeDay(state!, now: dependencies.now(), timezone: dependencies.timezone())
            if rolled != state { try await commit(rolled) }
            while true {
                if disposed { return }
                guard let current = state else { return }
                if let acknowledged = current.outbox.first(where: { $0.status == .acknowledged }) {
                    try await finalizeAcknowledgement(acknowledged)
                    continue
                }
                var blocked = Set<String>()
                var candidate: StoredReview?
                for review in current.outbox {
                    if review.status == .conflict {
                        blocked.insert(review.cardId)
                        continue
                    }
                    if review.status == .pending && !blocked.contains(review.cardId) {
                        candidate = review
                        break
                    }
                }
                guard let candidate else { break }
                do {
                    let acknowledgement = try await dependencies.sendReview(candidate.cardId, candidate.payload)
                    try acknowledgement.validate(expectedOperationID: candidate.payload.operationId)
                    if disposed { return }
                    guard acknowledgement.appliedRevision == candidate.payload.expectedRevision + 1 else {
                        throw LearnParseError(message: "Learn returned an unexpected applied revision")
                    }
                    var next = state!
                    next.outbox = next.outbox.map { review in
                        guard review.payload.operationId == candidate.payload.operationId else { return review }
                        var acknowledged = review
                        acknowledged.status = .acknowledged
                        acknowledged.acknowledgement = acknowledgement
                        return acknowledged
                    }
                    // The receipt reaches durable storage before this operation
                    // is removed or a dependent operation can be sent.
                    try await commit(next)
                } catch let failure as LearnReviewFailure where failure.code != nil {
                    if disposed { return }
                    let currentCard = failure.currentCard.map {
                        Learn.preserveCardText(LearnSync.projectedCards(state!).get(candidate.cardId), $0)
                    }
                    var next = state!
                    next.outbox = next.outbox.map { review in
                        guard review.payload.operationId == candidate.payload.operationId else { return review }
                        var conflicted = review
                        conflicted.status = .conflict
                        conflicted.conflict = StoredConflict(code: failure.code!, currentCard: currentCard)
                        return conflicted
                    }
                    try await commit(next)
                    continue
                } catch {
                    let offline = LearnSync.isOfflineError(error)
                    setConnection(
                        offline ? .offline : .error,
                        offline
                            ? "Saved reviews are waiting on this device for a connection."
                            : "Saved reviews could not sync. Try again."
                    )
                    return
                }
            }

            if state?.outbox.contains(where: { $0.status == .conflict }) == true {
                setConnection(.idle)
                return
            }
            if refresh {
                let today = try await dependencies.fetchToday()
                try today.validate()
                if disposed { return }
                try await installTodayInside(today)
            }
            setConnection(.idle)
        } catch {
            let offline = LearnSync.isOfflineError(error)
            setConnection(
                offline ? .offline : .error,
                offline
                    ? "Connect once to download verses, or keep practicing the saved session."
                    : "Learn could not refresh from the server. Try again."
            )
        }
    }

    private func finalizeAcknowledgement(_ review: StoredReview) async throws {
        guard let state, let acknowledgement = review.acknowledgement else { return }
        var cards = OrderedCards(state.cards)
        let current = acknowledgement.currentCard
        if let current {
            cards.set(Learn.preserveCardText(cards.get(review.cardId), current))
        } else {
            cards.delete(review.cardId)
        }
        let leavesToday = current.map {
            Learn.isCardDueAfterDay(
                $0,
                instant: dependencies.now(),
                timezone: LearnTime.validTimezone(dependencies.timezone())
            )
        } ?? true
        var next = state
        next.cards = Array(cards.values.prefix(LearnSync.maxCachedCards))
        if leavesToday { next.practiceCardIds.removeAll { $0 == review.cardId } }
        next.knownCount = state.knownCount + (review.before.knownAt == nil && current?.knownAt != nil ? 1 : 0)
        var outbox = state.outbox.filter { $0.payload.operationId != review.payload.operationId }
        let stale = current == nil || current!.revision > acknowledgement.appliedRevision
        if stale, let dependent = outbox.firstIndex(where: { $0.cardId == review.cardId && $0.status == .pending }) {
            outbox[dependent].status = .conflict
            outbox[dependent].conflict = StoredConflict(
                code: current == nil ? .missing : .revisionConflict,
                currentCard: current
            )
        }
        next.outbox = outbox
        try await commit(next)
    }

    /// The conflict notice's "Use latest schedule": drop this card's local
    /// reviews and take the server's schedule for it.
    func useLatestSchedule(_ cardID: String) async throws {
        try await exclusive { [self] in
            guard !disposed else { return }
            guard let state else { throw LearnParseError(message: "Learn has not hydrated") }
            guard let conflict = state.outbox.first(where: { $0.cardId == cardID && $0.status == .conflict }),
                  let details = conflict.conflict
            else { return }
            if details.code == .operationIdReused {
                setConnection(.syncing)
                do {
                    let today = try await dependencies.fetchToday()
                    try today.validate()
                    if disposed { return }
                    var without = self.state!
                    without.cards.removeAll { $0.id == cardID }
                    without.practiceCardIds.removeAll { $0 == cardID }
                    without.outbox.removeAll { $0.cardId == cardID }
                    try await commit(mergeToday(without, today))
                    setConnection(.idle)
                } catch {
                    setConnection(
                        LearnSync.isOfflineError(error) ? .offline : .error,
                        "The latest schedule could not be loaded. Your saved reviews were kept."
                    )
                }
                return
            }
            var cards = OrderedCards(state.cards)
            let current = details.currentCard
            if details.code == .revisionConflict {
                if let current {
                    cards.set(Learn.preserveCardText(cards.get(cardID), current))
                } else {
                    cards.delete(cardID)
                }
            }
            let remove = current.map {
                Learn.isCardDueAfterDay(
                    $0,
                    instant: dependencies.now(),
                    timezone: LearnTime.validTimezone(dependencies.timezone())
                )
            } ?? true
            var next = state
            next.cards = Array(cards.values.prefix(LearnSync.maxCachedCards))
            if remove { next.practiceCardIds.removeAll { $0 == cardID } }
            next.outbox.removeAll { $0.cardId == cardID }
            try await commit(next)
            await synchronizeInside(refresh: true)
        }
    }
}
