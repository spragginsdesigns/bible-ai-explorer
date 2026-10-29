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

    var section: AppSection {
        get { selectedSection }
        set {
            let requestID = UUID()
            sectionRequestID = requestID
            guard newValue != selectedSection, noteDeparture.hasEditor else {
                selectedSection = newValue
                return
            }
            Task {
                guard await noteDeparture.canLeave(), sectionRequestID == requestID else { return }
                selectedSection = newValue
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
    var pendingVerseReference: String?
    /// Translation that produced the pending chat source. This is a one-hop
    /// reader override and never mutates the account preference.
    var pendingVerseTranslation: TranslationID?
    /// Set when a chat note-receipt asks to open the note it wrote; consumed
    /// by the Notes root, which opens the editor (the iOS tab pushes it, the
    /// macOS section selects it). The notes counterpart of
    /// `pendingVerseReference`.
    var pendingNoteID: String?
    /// Set when a chat "Learning John 3:16" receipt asks for Learn a verse on
    /// the Mac; consumed by the Bible section, which shows its Learn pane. iOS
    /// pushes `LearnView` from the chat stack instead and never sets it.
    var pendingDailyDestination: DailyWalkDestination?
    /// Set to open a Study hub page from elsewhere; consumed (and cleared) by
    /// the Study root once it has shown the page.
    var pendingStudyDestination: StudyHubDestination?
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
