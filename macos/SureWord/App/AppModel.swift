import Foundation

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

    var section: AppSection = .chat
    var isSettingsPresented = false
    /// Set when a verse card asks to open the reader; consumed by the Bible
    /// phase once that pane exists.
    var pendingVerseReference: String?

    init(settings: SettingsStore) {
        self.settings = settings
        // A second 401 after the fresh-token retry means the session itself is
        // invalid, so sign out locally rather than leaving the app looking
        // signed in while every request fails.
        api = APIClient(
            token: ClerkAuth.tokenProvider,
            onAuthFailure: { await ClerkAuth.signOut() }
        )
        chat = ChatViewModel(api: api, settings: settings)
        bible = BibleModel(api: api)
    }
}
