import Foundation

/// Learn a verse for one signed-in account: the practice session over
/// `LearnSyncStore`, the "Suggested for you" rows, and the entry point every
/// other screen calls to add a verse.
///
/// The Apple counterpart of the state in `mobile/src/features/learn/LearnScreen.tsx`
/// (and `AddLearnButton.tsx` for `add`). Owned by `AppModel`, so the store
/// survives a trip away from the screen and one hydrate serves the session.
///
/// **Adding a verse from anywhere** (reader verse sheet, highlights, a chat
/// card): call `app.learn.add(book:chapter:verse:translation:source:)`, or
/// `add(reference:translation:source:)` with a reference string, or drop in
/// `LearnThisVerseButton`, which wraps the call with Android's
/// "Learn this verse" / "Adding..." / "Added to Learn." states.
@MainActor
@Observable
final class LearnModel {
    /// Back-off for an offline sync while the screen is visible, as on Android.
    static let retryDelays: [Duration] = [.milliseconds(1_500), .seconds(5), .seconds(15)]

    /// Nil when nobody is signed in: the screen says so and nothing is stored.
    let account: String?

    private(set) var snapshot: LearnSyncSnapshot
    /// Bumped by every review, so a card that stays on screen starts a fresh round.
    private(set) var round = 0
    private(set) var selection: LearnModeSelection?
    /// The practice round whose typed answer was word for word, if any.
    private(set) var typedRound: String?
    private(set) var interactionBusy = false
    private(set) var localError: String?
    private(set) var suggestions: [LearnSuggestion] = []
    private(set) var dismissed: Set<String> = []
    private(set) var added: Set<String> = []
    private(set) var confirmation: String?
    /// Bundled KJV text by verse key - the reader's own text wins over the
    /// server's copy for a KJV card, exactly as Android reads `getKjvChapter`.
    private(set) var bundledText: [String: String] = [:]

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let store: LearnSyncStore?
    @ObservationIgnored private var hydration: Task<Void, Never>?
    @ObservationIgnored private var hydrated = false
    @ObservationIgnored private var visible = false
    @ObservationIgnored private var retryAttempt = 0
    @ObservationIgnored private var retryTask: Task<Void, Never>?
    @ObservationIgnored private var suggestionsInFlight = false

    init(
        account: String?,
        api: APIClient,
        storage: (any LearnStorage)? = nil,
        dependencies: LearnSyncDependencies? = nil
    ) {
        self.account = account
        self.api = api
        if let account {
            let resolved = dependencies ?? LearnSyncDependencies(
                storage: storage ?? LearnDefaultsStorage(),
                fetchToday: { try await LearnAPI.today(api: api) },
                sendReview: { cardID, payload in
                    try await LearnAPI.review(api: api, cardID: cardID, payload: payload)
                },
                createOperationID: { UUID().uuidString.lowercased() },
                now: { Date() },
                timezone: { TimeZone.current.identifier }
            )
            let store = LearnSyncStore(userID: account, dependencies: resolved)
            self.store = store
            snapshot = store.getSnapshot()
            store.subscribe { [weak self] next in self?.apply(next) }
        } else {
            store = nil
            snapshot = LearnSyncSnapshot(
                hydrated: false,
                today: nil,
                downloadedCards: [],
                pendingCount: 0,
                conflicts: [],
                connection: .initializing,
                message: nil
            )
        }
    }

    private func apply(_ next: LearnSyncSnapshot) {
        snapshot = next
        loadBundledText()
    }

    // MARK: - Lifecycle

    /// The screen appeared (or the app came back to the front while it is up).
    func appear() {
        visible = true
        guard store != nil else { return }
        if hydrated {
            runSync(reset: true)
        } else if hydration == nil {
            hydration = Task { [weak self] in
                guard let self, let store = self.store else { return }
                do {
                    try await store.hydrate()
                    self.hydrated = true
                    self.runSync(reset: true)
                } catch {
                    // The store already published the storage error.
                }
                self.hydration = nil
            }
        }
        Task { await loadSuggestions() }
    }

    func disappear() {
        visible = false
        retryTask?.cancel()
        retryTask = nil
    }

    func sceneBecameActive() {
        guard visible else { return }
        runSync(reset: true)
    }

    /// Sync now (Retry, Reconnect, Reload verse). Retries on its own while the
    /// screen stays up and the device stays offline.
    func runSync(reset: Bool = false) {
        guard visible, let store, store.getSnapshot().hydrated else { return }
        if reset { retryAttempt = 0 }
        retryTask?.cancel()
        retryTask = Task { [weak self] in
            await store.synchronize()
            guard let self, !Task.isCancelled, self.visible,
                  store.getSnapshot().connection == .offline,
                  self.retryAttempt < Self.retryDelays.count
            else { return }
            let delay = Self.retryDelays[self.retryAttempt]
            self.retryAttempt += 1
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self.runSync(reset: false)
        }
    }

    private func loadSuggestions() async {
        guard account != nil, !suggestionsInFlight else { return }
        suggestionsInFlight = true
        defer { suggestionsInFlight = false }
        suggestions = await LearnAPI.suggestions(api: api)
    }

    // MARK: - What is on screen

    var today: LearnToday? { snapshot.today }
    var card: LearnCard? { snapshot.today?.cards.first }

    func verseText(_ card: LearnCard) -> String {
        if card.translation == "KJV",
           let bundled = bundledText[Self.verseKey(card)],
           !bundled.isEmpty {
            return bundled
        }
        return card.text
    }

    var practice: LearnModeSelection? {
        guard let card else { return nil }
        return LearnPractice.resolveMode(id: card.id, revision: card.revision, stage: card.stage, previous: selection)
    }

    var mode: LearnMode { practice?.mode ?? .blanks }

    /// Identifies one round of practice: the card, its revision, the round and
    /// the mode. The practice view is re-keyed by it, which is what clears it.
    var practiceRound: String {
        guard let card else { return "" }
        return "\(card.id):\(card.revision):\(round):\(mode.rawValue)"
    }

    /// Type it out passes "good" only when every word matched.
    var typedReady: Bool {
        mode != .typed || (!practiceRound.isEmpty && typedRound == practiceRound)
    }

    var conflict: LearnConflictView? { snapshot.conflicts.first }

    var cardBlocked: Bool {
        guard let card else { return false }
        return snapshot.conflicts.contains { $0.cardId == card.id }
    }

    var disabled: Bool {
        guard let card else { return true }
        return interactionBusy || cardBlocked || verseText(card).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var showInitialLoading: Bool {
        snapshot.today == nil && (snapshot.connection == .initializing || snapshot.connection == .syncing)
    }

    var pendingLabel: String {
        "\(snapshot.pendingCount) saved review\(snapshot.pendingCount == 1 ? "" : "s")"
    }

    var suggestionsView: LearnSuggestionsView {
        LearnSuggestions.view(suggestions: suggestions, dismissed: dismissed, added: added, hasCard: card != nil)
    }

    /// The empty-state hint, chosen the way `LearnScreen.tsx` chooses it.
    var emptyHint: String {
        if snapshot.pendingCount > 0 {
            return "Your practice is saved on this device and will update the schedule after it syncs."
        }
        if let today, today.queueCount > 0 { return "Your next verses will be ready when they are due." }
        if !snapshot.downloadedCards.isEmpty {
            return "Your downloaded verses remain saved for the next offline practice session."
        }
        return "Choose Learn this verse from the Bible reader or a highlight."
    }

    // MARK: - Actions

    func chooseMode(_ mode: LearnMode) {
        guard let card else { return }
        selection = LearnPractice.chooseMode(id: card.id, revision: card.revision, mode: mode)
    }

    func setTypedScore(perfect: Bool, round: String) {
        typedRound = perfect ? round : nil
    }

    func review(_ result: LearnResult) async {
        guard let store, let card, !interactionBusy, !cardBlocked,
              !verseText(card).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }
        if result == .good && !typedReady { return }
        let wasOffline = store.getSnapshot().connection == .offline
        interactionBusy = true
        localError = nil
        defer { interactionBusy = false }
        do {
            try await store.enqueue(card.id, result: result)
            round += 1
            if !wasOffline { runSync(reset: false) }
        } catch {
            localError = (error as? LocalizedError)?.errorDescription ?? "Could not save this review."
        }
    }

    func useLatest() async {
        guard let store, let conflict, !interactionBusy else { return }
        interactionBusy = true
        localError = nil
        defer { interactionBusy = false }
        do {
            try await store.useLatestSchedule(conflict.cardId)
            round += 1
        } catch {
            localError = (error as? LocalizedError)?.errorDescription ?? "Could not load the latest schedule."
        }
    }

    func dismissSuggestion(_ suggestion: LearnSuggestion) {
        dismissed.insert(suggestion.id)
    }

    /// A suggestion row's add landed.
    func suggestionAdded(_ suggestion: LearnSuggestion) {
        added.insert(suggestion.id)
        confirmation = LearnSuggestions.addedConfirmation(suggestion.reference)
        // With nothing due, the added verse is the session; a sync brings it in.
        if card == nil { runSync(reset: true) }
    }

    // MARK: - The entry point for other screens

    /// Add a verse to this account's Learn queue. Idempotent on the server, so
    /// a second call returns the card as it stands.
    @discardableResult
    func add(
        book: Int,
        chapter: Int,
        verse: Int,
        translation: String,
        source: LearnAPI.Source
    ) async throws -> LearnCard {
        guard account != nil else { throw LearnParseError(message: "Sign in to learn your verses.") }
        let card = try await LearnAPI.add(
            api: api,
            book: book,
            chapter: chapter,
            verse: verse,
            translation: translation,
            source: source
        )
        // If the screen is up with nothing due, show the new card straight away.
        if visible && self.card == nil { runSync(reset: true) }
        return card
    }

    /// `add` from a reference such as "John 3:16" (a chapter alone is refused:
    /// Learn holds single verses).
    @discardableResult
    func add(reference: String, translation: String, source: LearnAPI.Source) async throws -> LearnCard {
        guard let resolved = Bible.resolveReference(reference), let verse = resolved.verse else {
            throw LearnParseError(message: "Choose a single verse to learn.")
        }
        return try await add(
            book: resolved.order,
            chapter: resolved.chapter,
            verse: verse,
            translation: translation,
            source: source
        )
    }

    // MARK: - Bundled text

    private static func verseKey(_ card: LearnCard) -> String {
        "\(card.book):\(card.chapter):\(card.verse)"
    }

    private func loadBundledText() {
        let wanted = (snapshot.today?.cards ?? []).filter {
            $0.translation == "KJV" && bundledText[Self.verseKey($0)] == nil
        }
        guard !wanted.isEmpty else { return }
        Task { [weak self] in
            for card in wanted {
                guard let verses = try? await KJVLibrary.shared.chapter(order: card.book, chapter: card.chapter),
                      verses.indices.contains(card.verse - 1)
                else { continue }
                self?.bundledText[Self.verseKey(card)] = verses[card.verse - 1]
            }
        }
    }
}
