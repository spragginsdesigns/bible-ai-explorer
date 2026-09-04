import Foundation

/// Primary sections, matching Android's bottom tab bar
/// (`mobile/app/(app)/_layout.tsx`) — laid out as a sidebar on macOS and a tab
/// bar on iOS, the platform idioms for the same thing.
/// `cross` is declared last on purpose: the macOS `AppCommands` derives ⌘1…⌘n
/// from this order, and inserting it next to `bible` would silently renumber
/// shortcuts people already have in their fingers.
enum AppSection: String, CaseIterable, Identifiable {
    case chat, bible, notes, cross

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chat: "Chat"
        case .bible: "Bible"
        case .notes: "Notes"
        case .cross: "Daily Cross"
        }
    }

    var symbol: String {
        switch self {
        case .chat: "sparkles"
        case .bible: "book.closed"
        case .notes: "note.text"
        case .cross: "cross"
        }
    }
}

/// Root state for a signed-in session: the API client, the shared settings, and
/// the chat and Bible models. Created once the user is signed in so the API
/// client's token provider always has a session behind it.
@MainActor
@Observable
final class AppModel {
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

    var section: AppSection = .chat
    var isSettingsPresented = false
    /// Set when a verse card asks to open the reader; consumed by the Bible
    /// phase once that pane exists.
    var pendingVerseReference: String?
    /// Set when a chat note-receipt asks to open the note it wrote; consumed
    /// by the Notes tab root, which pushes the editor. The iOS counterpart of
    /// `pendingVerseReference` (macOS opens notes inside its own section and
    /// never needs this).
    var pendingNoteID: String?

    /// `userID` is the Clerk id of the session this model is being built for.
    /// It is what tells the preference sync whether the persisted caches belong
    /// to this account or to the last one signed in on this device.
    init(settings: SettingsStore, userID: String?) {
        self.settings = settings
        // A second 401 after the fresh-token retry means the session itself is
        // invalid, so sign out locally rather than leaving the app looking
        // signed in while every request fails.
        api = APIClient(
            token: ClerkAuth.tokenProvider,
            onAuthFailure: { await ClerkAuth.signOut() }
        )
        chat = ChatViewModel(api: api, settings: settings)
        highlights = HighlightsStore(api: api, cacheURL: HighlightsStore.defaultCacheURL)
        bible = BibleModel(api: api)
        bible.highlights = highlights
        dailyCross = DailyCrossModel(api: api)
        suggestedQuestions = SuggestedQuestionsModel(api: api)
        atlas = AtlasModel(api: api)
        preferences = PreferencesSyncModel(transport: api, settings: settings)
        // Runs before anything has read the caches: the notes and highlights
        // stores hydrate lazily, so clearing them here is what stops a second
        // account seeing the first one's notes.
        let highlights = self.highlights
        preferences.start(userID: userID) {
            highlights.clearCache()
            NotesStore.shared.clearCache()
        }
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
        Task { @MainActor in
            chat.teardown()
            listen.reset()
        }
    }
}
