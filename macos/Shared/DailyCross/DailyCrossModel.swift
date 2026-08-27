import Foundation

/// Loads and holds today's "Pick Up Your Cross" entry.
///
/// Owned by `AppModel` rather than the view: the Daily Cross pane is destroyed
/// every time the sidebar switches away from it, and a generation that costs a
/// model call must not be thrown away and re-run because the user looked at
/// chat for a moment. The server's 20h reuse window means a second fetch would
/// return the same day anyway — this just avoids the round trip.
@MainActor
@Observable
final class DailyCrossModel {
    private(set) var entry: DailyCrossEntry?
    private(set) var error: String?
    private(set) var isLoading = false

    /// Today's spoken devotional. Owned here rather than by the card for the
    /// same reason the day is: the pane is destroyed whenever the sidebar
    /// moves, and a listen must not stop because the user glanced at chat.
    let listen: ListenModel

    private let api: APIClient
    private var task: Task<Void, Never>?

    init(api: APIClient) {
        self.api = api
        listen = ListenModel(api: api)
    }

    /// Fetch the day unless one is already in hand. `force` is the retry path
    /// and the only way to go back to the server within a session.
    func load(force: Bool = false) {
        if !force, entry != nil { return }
        if isLoading, !force { return }

        task?.cancel()
        isLoading = true
        error = nil

        task = Task {
            do {
                let entry = try await DailyCrossAPI.today(api: api)
                guard !Task.isCancelled else { return }
                self.entry = entry
                listen.reference = entry.reference
                error = nil
            } catch {
                guard !Task.isCancelled else { return }
                self.error = (error as? APIError)?.message
                    ?? "Today's word could not be loaded. Check your connection and try again."
            }
            isLoading = false
        }
    }

    /// Drop the cached day so the next `load()` goes back to the server. Called
    /// when this session's chat replaced the day: unlike the other clients,
    /// whose Daily Cross screens are rebuilt (and refetched) on every visit,
    /// this model survives the sidebar, so it would otherwise keep showing the
    /// word that was just replaced.
    func invalidate() {
        task?.cancel()
        entry = nil
        error = nil
        isLoading = false
        // The narration belongs to the word that was just replaced; a voice
        // still reading it under the new day would be the wrong day speaking.
        listen.reset()
    }

    /// Replace today's word with a newly prepared one, optionally centred on
    /// what the user typed. The old entry is dropped first so the screen shows
    /// the preparing state rather than the day being replaced.
    func replaceToday(focus: String?) {
        task?.cancel()
        entry = nil
        error = nil
        isLoading = true
        // A new word gets a new narration; the old one must stop and the card
        // go back to preparing.
        listen.reset()

        task = Task {
            do {
                let replacement = try await DailyCrossAPI.replaceToday(api: api, focus: focus)
                guard !Task.isCancelled else { return }
                entry = replacement
                listen.reference = replacement.reference
                error = nil
            } catch {
                guard !Task.isCancelled else { return }
                self.error = (error as? APIError)?.message
                    ?? "A new word could not be prepared. Check your connection and try again."
            }
            isLoading = false
        }
    }

    /// Today's date in the user's locale, the line under the title — matching
    /// `toLocaleDateString(undefined, { weekday, month, day })` on the other
    /// clients.
    var todayLabel: String {
        Date.now.formatted(
            .dateTime.weekday(.wide).month(.wide).day()
        )
    }
}
