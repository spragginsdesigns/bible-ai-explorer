import Foundation

/// Five destinations shared with Android. Legacy leaf destinations retain
/// their identity while selection belongs to their owning primary section.
enum AppSection: String, CaseIterable, Identifiable {
    case today, bible, chat, connections, study, notes, cross

    /// Legacy destinations remain routable without adding overflow tabs.
    static let allCases: [AppSection] = [.today, .bible, .chat, .connections, .study]
    var primary: AppSection {
        switch self {
        case .notes: .study
        case .cross: .today
        default: self
        }
    }

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .connections: "Connections"
        case .study: "Study"
        case .chat: "Chat"
        case .bible: "Bible"
        case .notes: "Notes"
        case .cross: "Daily Cross"
        }
    }

    var symbol: String {
        switch self {
        case .today: "sun.max"
        case .connections: "point.3.connected.trianglepath.dotted"
        case .study: "safari"
        case .chat: "bubble.left.and.bubble.right"
        case .bible: "book"
        case .notes: "note.text"
        case .cross: "cross"
        }
    }
}

enum DailyWalkDestination: String, Hashable { case plan, learn, history, serve }

/// A page inside the Study hub that another surface asked to open (What's new
/// "Try it", the Today notes link). Consumed by the Study root on each
/// platform, which pushes (iOS) or selects (macOS) the page.
enum StudyHubDestination: String, Hashable { case notes, timeline, people, places, sermons, words }

/// A Settings page another surface asked to open: a chat receipt, the Daily
/// Cross's AI-off notice, a Pro wall. Consumed by Settings on each platform,
/// which maps it onto its own pane (macOS) or pushed page (iOS).
enum SettingsPageRequest: String, Hashable { case account, ai, membership, memory, church, notifications }

/// Root state for a signed-in session: the API client, the shared settings, and
/// the chat and Bible models. Created once the user is signed in so the API
/// client's token provider always has a session behind it.
@MainActor
@Observable
final class AppModel {
    let userID: String?
    let settings: SettingsStore
    let api: APIClient
    let chat: ChatViewModel
    /// Reader state. It lives here, not in `BibleSection`, because the section
    /// views are torn down whenever the sidebar switches away from them —
    /// Android keeps its bible stack mounted, so the book, chapter and pane must
    /// survive a trip through chat.
    let bible: BibleModel
    /// Verse-highlight cache. Owned here for the same reason the reader is,
    /// and shared by every verse row on both platforms.
    let highlights: HighlightsStore
    /// Today's guided walk. Owned here for the same reason the reader is: the
    /// Daily Cross pane dies whenever the sidebar moves, and re-fetching would
    /// mean paying for a generation again just because the user glanced at chat.
    let dailyCross: DailyCrossModel
    /// This user's opening questions. Owned here so one generation serves every
    /// new chat in the session, and so signing out drops them with the account.
    let suggestedQuestions: SuggestedQuestionsModel
    /// Shared Bible atlas networking/state for both native shells.
    let atlas: AtlasModel
    /// Account preferences: hydrates the settings from the server and writes
    /// every change back. Owned here so one pipe serves the Settings screens,
    /// the model picker and the reader alike.
    let preferences: PreferencesSyncModel
    /// Learn a verse for this account: the offline practice session, its
    /// review outbox, and `add(...)`, the entry point every screen that shows a
    /// verse calls. Keyed by `userID`, so the outbox never crosses accounts.
    let learn: LearnModel
    /// AI data-sharing consent for this account (PRD A4): the gate every AI
    /// entry point passes, and the Settings → AI row.
    let aiConsent: AIConsentStore
    let chapterAudio: ChapterAudioModel
    /// Walk with me, the guided first run: its start, cards, spotlight,
    /// Getting started card and voice mode, for this account.
    let onboarding: OnboardingModel
    /// Ways to Serve: one instance so the Today card, the page and the
    /// Settings row agree the moment the mode changes.
    let serve: ServeModel

    let noteDeparture = NoteDepartureCoordinator()
    private var selectedSection: AppSection = .today
    private var sectionRequestID = UUID()
    let navigationOwnerID = UUID()
    /// Startup work may navigate only until a newer explicit route is asked
    /// for, including a tap on the section that is already selected.
    private(set) var navigationIntentID = UUID()
    private(set) var hasNavigationIntent = false

    func recordNavigationIntent() {
        hasNavigationIntent = true
        navigationIntentID = UUID()
        pendingNoteID = nil
        pendingVerseRoute = nil
        pendingDailyRoute = nil
        pendingStudyRoute = nil
        PendingDeepLinks.shared.invalidateDelayedArrivals()
    }

    /// A Notes route belongs to one explicit navigation intent and account
    /// epoch, even when several routes share the same pending autosave.
    struct NoteNavigationRequest: Equatable {
        let intentID: UUID
        let epoch: UUID

        @MainActor
        func perform(
            isCurrent: @MainActor () -> Bool,
            departure: NoteDepartureCoordinator,
            action: @MainActor () -> Void
        ) async -> Bool {
            guard isCurrent() else { return false }
            guard await departure.canLeave(), isCurrent() else { return false }
            action()
            return true
        }
    }

    struct VerseDestination: Equatable {
        let reference: String
        let translation: TranslationID?
    }

    /// Payload and ownership travel together, including an explicit nil
    /// translation. Consumers never adopt an old payload as a fresh intent.
    struct PendingDestination<Value: Equatable>: Equatable {
        let request: NoteNavigationRequest
        let value: Value

        @MainActor
        func perform(
            isCurrent: @MainActor () -> Bool,
            departure: NoteDepartureCoordinator,
            action: @MainActor (Value) -> Void
        ) async -> Bool {
            await request.perform(isCurrent: isCurrent, departure: departure) {
                action(value)
            }
        }
    }

    /// Mint before suspending, including a tap on the note already selected.
    /// A direct Notes action supersedes a receipt that has not been consumed.
    func beginNoteNavigation() -> NoteNavigationRequest {
        recordNavigationIntent()
        return currentNoteNavigationRequest()
    }

    /// Pending destinations already own an intent; consuming one must not
    /// supersede a newer row, Back, or section tap.
    func currentNoteNavigationRequest() -> NoteNavigationRequest {
        NoteNavigationRequest(intentID: navigationIntentID, epoch: NotesStore.shared.epoch)
    }

    func isCurrentNoteNavigationRequest(_ request: NoteNavigationRequest) -> Bool {
        !Task.isCancelled && NotesStore.shared.isCurrent(request.epoch)
            && navigationIntentID == request.intentID
    }

    @discardableResult
    func performNoteNavigation(
        _ request: NoteNavigationRequest,
        action: @MainActor () -> Void
    ) async -> Bool {
        await request.perform(
            isCurrent: { self.isCurrentNoteNavigationRequest(request) },
            departure: noteDeparture,
            action: action
        )
    }

    /// Publish a guarded route without creating another intent when the
    /// shell mirrors its tab. Preserve legacy Notes ownership in Study.
    @discardableResult
    func commitNavigationSection(_ value: AppSection, request: NoteNavigationRequest) -> Bool {
        guard isCurrentNoteNavigationRequest(request) else { return false }
        selectedSection = value
        return true
    }

    /// Stage the note only after departure succeeds. Setting the section
    /// first avoids a section-setter echo invalidating the pending payload.
    func openNote(_ id: String) {
        let request = beginNoteNavigation()
        Task {
            await performNoteNavigation(request) {
                guard commitNavigationSection(.notes, request: request) else { return }
                pendingNoteID = id
            }
        }
    }

    private func afterNoteDeparture(_ request: NoteNavigationRequest, action: @escaping @MainActor () -> Void) {
        guard noteDeparture.hasEditor else {
            guard isCurrentNoteNavigationRequest(request) else { return }
            action()
            return
        }
        Task { await performNoteNavigation(request, action: action) }
    }

    func openVerse(_ reference: String, translation: TranslationID? = nil) {
        guard Bible.resolveReference(reference) != nil else { return }
        let request = beginNoteNavigation()
        afterNoteDeparture(request) { self.commitVerse(reference, translation: translation, request: request) }
    }

    @discardableResult
    func commitVerse(_ reference: String, translation: TranslationID?, request: NoteNavigationRequest) -> Bool {
        guard commitNavigationSection(.bible, request: request) else { return false }
        pendingVerseRoute = PendingDestination(request: request, value: VerseDestination(reference: reference, translation: translation))
        return true
    }

    func openDaily(_ destination: DailyWalkDestination) {
        let request = beginNoteNavigation()
        afterNoteDeparture(request) {
            guard self.commitNavigationSection(.today, request: request) else { return }
            self.pendingDailyRoute = PendingDestination(request: request, value: destination)
        }
    }

    func openStudy(_ destination: StudyHubDestination) {
        let request = beginNoteNavigation()
        afterNoteDeparture(request) { self.commitStudy(destination, request: request) }
    }

    /// Commit a Study leaf with the same intent that passed note departure.
    /// Voice and tap routes share this seam without minting a second request.
    @discardableResult
    func commitStudy(_ destination: StudyHubDestination, request: NoteNavigationRequest) -> Bool {
        #if os(macOS)
        if destination == .notes { return commitNavigationSection(.notes, request: request) }
        #endif
        guard commitNavigationSection(.study, request: request) else { return false }
        pendingStudyRoute = PendingDestination(request: request, value: destination)
        return true
    }

    @discardableResult
    func consumeVerse(_ route: PendingDestination<VerseDestination>, action: @MainActor (VerseDestination) -> Void) async -> Bool {
        await route.perform(isCurrent: {
            self.isCurrentNoteNavigationRequest(route.request) && self.pendingVerseRoute == route
        }, departure: noteDeparture) { value in
            action(value)
            if self.pendingVerseRoute == route { self.pendingVerseRoute = nil }
        }
    }

    @discardableResult
    func consumeDaily(_ route: PendingDestination<DailyWalkDestination>, action: @MainActor (DailyWalkDestination) -> Void) async -> Bool {
        await route.perform(isCurrent: {
            self.isCurrentNoteNavigationRequest(route.request) && self.pendingDailyRoute == route
        }, departure: noteDeparture) { value in
            action(value)
            if self.pendingDailyRoute == route { self.pendingDailyRoute = nil }
        }
    }

    @discardableResult
    func consumeStudy(_ route: PendingDestination<StudyHubDestination>, action: @MainActor (StudyHubDestination) -> Void) async -> Bool {
        await route.perform(isCurrent: {
            self.isCurrentNoteNavigationRequest(route.request) && self.pendingStudyRoute == route
        }, departure: noteDeparture) { value in
            action(value)
            if self.pendingStudyRoute == route { self.pendingStudyRoute = nil }
        }
    }

    var section: AppSection {
        get { selectedSection }
        set {
            recordNavigationIntent()
            let requestID = UUID()
            sectionRequestID = requestID
            guard newValue != selectedSection, noteDeparture.hasEditor else {
                selectedSection = newValue
                return
            }
            let navigationRequest = currentNoteNavigationRequest()
            Task {
                await performNoteNavigation(navigationRequest) {
                    guard sectionRequestID == requestID else { return }
                    selectedSection = newValue
                }
            }
        }
    }
    var connectionPlace = ConnectionsPlace(order: 43, chapter: 3, verse: 16)

    func openConnections(order: Int, chapter: Int, verse: Int? = nil) {
        guard let place = ConnectionsPlace.validated(order: order, chapter: chapter, verse: verse) else { return }
        connectionPlace = place
        section = .connections
    }
    var isSettingsPresented = false {
        didSet { bible.reading.setObscured(isSettingsPresented, reason: "settings") }
    }
    /// Set when a verse card asks to open the reader; consumed by the Bible
    /// phase once that pane exists.
    private(set) var pendingVerseRoute: PendingDestination<VerseDestination>?
    var pendingVerseReference: String? { pendingVerseRoute?.value.reference }
    /// Translation that produced the pending chat source. This is a one-hop
    /// reader override and never mutates the account preference.
    var pendingVerseTranslation: TranslationID? { pendingVerseRoute?.value.translation }
    /// Set when a chat note-receipt asks to open the note it wrote; consumed
    /// by the Notes root, which opens the editor (the iOS tab pushes it, the
    /// macOS section selects it). The notes counterpart of
    /// `pendingVerseReference`.
    var pendingNoteID: String?
    /// Set when a chat "Learning John 3:16" receipt asks for Learn a verse on
    /// the Mac; consumed by the Bible section, which shows its Learn pane. iOS
    /// pushes `LearnView` from the chat stack instead and never sets it.
    private(set) var pendingDailyRoute: PendingDestination<DailyWalkDestination>?
    var pendingDailyDestination: DailyWalkDestination? { pendingDailyRoute?.value }
    /// Set to open a Study hub page from elsewhere; consumed (and cleared) by
    /// the Study root once it has shown the page.
    private(set) var pendingStudyRoute: PendingDestination<StudyHubDestination>?
    var pendingStudyDestination: StudyHubDestination? { pendingStudyRoute?.value }
    /// Set by `openSettings(_:)`; consumed (and cleared) by Settings once it
    /// has shown the page.
    var pendingSettingsPage: SettingsPageRequest?

    /// Opens Settings on `page`. The single entry point for "take me to that
    /// setting", so every caller lands the same way on both platforms.
    func openSettings(_ page: SettingsPageRequest) {
        pendingSettingsPage = page
        isSettingsPresented = true
    }

    /// `userID` is the Clerk id of the session this model is being built for.
    /// It is what tells the preference sync whether the persisted caches belong
    /// to this account or to the last one signed in on this device.
    init(settings: SettingsStore, userID: String?) {
        self.userID = userID
        self.settings = settings
        let requestOwner = ClerkAuth.requestOwner(for: userID)
        let backgroundRequestOwner = ClerkAuth.requestOwner(for: userID, canSignOut: false)
        // A second 401 after the fresh-token retry means the session itself is
        // invalid, so sign out locally rather than leaving the app looking
        // signed in while every request fails.
        api = APIClient(
            token: { fresh in
                guard let userID else { return nil }
                return try await ClerkAuth.token(for: userID, fresh: fresh)
            },
            onAuthFailure: { await ClerkAuth.signOut(ifAccount: userID) },
            requestOwner: requestOwner
        )
        chat = ChatViewModel(api: api, settings: settings)
        highlights = HighlightsStore(api: api, cacheURL: HighlightsStore.defaultCacheURL)
        let readingAPI = APIClient(
            token: { fresh in
                guard let userID else { return nil }
                return try await ClerkAuth.token(for: userID, fresh: fresh)
            },
            onAuthFailure: { },
            requestOwner: backgroundRequestOwner
        )
        bible = BibleModel(api: api, reading: ReadingJournal(account: userID, api: readingAPI))
        bible.highlights = highlights
        dailyCross = DailyCrossModel(api: api)
        suggestedQuestions = SuggestedQuestionsModel(api: api)
        atlas = AtlasModel(api: api)
        preferences = PreferencesSyncModel(transport: api, settings: settings)
        aiConsent = AIConsentStore(account: userID, transport: api, askOnLaunch: true)
        chapterAudio = ChapterAudioModel(api: api, settings: settings)
        onboarding = OnboardingModel(api: api, account: userID)
        serve = ServeModel(api: api)
        preferences.aiConsent = aiConsent
        AIConsentGate.install(aiConsent)
        // Account-guarded like the reading journal's client: a queued review
        // must never go out under a newly signed-in account's token.
        let learnAPI = APIClient(
            token: { fresh in
                guard let userID else { return nil }
                return try await ClerkAuth.token(for: userID, fresh: fresh)
            },
            onAuthFailure: { },
            requestOwner: backgroundRequestOwner
        )
        learn = LearnModel(account: userID, api: learnAPI)
        // Runs before anything has read the caches: the notes and highlights
        // stores hydrate lazily, so clearing them here is what stops a second
        // account seeing the first one's notes.
        let highlights = self.highlights
        preferences.start(userID: userID) {
            highlights.clearCache()
            NotesStore.shared.clearCache()
        }
        NotesStore.shared.bindAccount(userID)
    }

    /// The session ended. Signing out drops this model (see the `onChange` in
    /// both app roots), but dropping it is not enough on its own: a chat
    /// recovery poll running at that moment would keep the view model alive and
    /// keep calling `/api/conversations` with a token that is now dead, which
    /// the API client answers with a local sign-out per 401 pair. Tearing the
    /// chat model down explicitly ends the poll at the same moment the session
    /// does.
    deinit {
        let chat = chat
        let listen = dailyCross.listen
        let reading = bible.reading
        let consent = aiConsent
        let chapterAudio = chapterAudio
        let onboarding = onboarding
        Task { @MainActor in
            onboarding.teardown()
            consent.cancelPending()
            chapterAudio.close()
            chat.teardown()
            listen.reset()
            reading.teardown()
        }
    }
}
