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
    /// A replacement ("A different word for today", "Stay with this", "Take me
    /// somewhere fresh") is in flight. The current day stays visible.
    private(set) var isReplacing = false
    /// Rises each time a replacement lands, so the screen can scroll back to
    /// the verse (and fire its haptic) for that and only that.
    private(set) var replacedCount = 0

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

        // A forced reload supersedes a replacement still in flight.
        isReplacing = false

        task = Task {
            do {
                let entry = try await DailyCrossAPI.today(api: api)
                guard !Task.isCancelled else { return }
                adopt(entry)
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
        isReplacing = false
        // The narration belongs to the word that was just replaced; a voice
        // still reading it under the new day would be the wrong day speaking.
        listen.reset()
    }

    /// Replace today's word with a newly prepared one, optionally centred on
    /// what the user typed and optionally steered by `direction` ("stay with
    /// this" keeps today's theme, "somewhere fresh" widens the window away from
    /// it).
    ///
    /// As on Android (1.37.1+), the current day stays on screen while the new
    /// one is prepared - the screen shows "Preparing a fresh word…" in place of
    /// the controls - and a failure leaves it there too, with the error as an
    /// inline card above the timeline. Only when the new word lands does the
    /// Listen card move to it.
    ///
    /// One path for all three: the typed-focus confirmation and the two quiet
    /// direction buttons share this busy state and this error, so a 409 for a
    /// day with no theme surfaces exactly where a failed refresh does.
    func replaceToday(focus: String? = nil, direction: DailyCrossDirection? = nil) {
        guard !isReplacing else { return }
        task?.cancel()
        error = nil
        isLoading = false
        isReplacing = true

        task = Task {
            do {
                let replacement = try await DailyCrossAPI.replaceToday(
                    api: api,
                    focus: focus,
                    direction: direction
                )
                guard !Task.isCancelled else { return }
                adopt(replacement)
                replacedCount &+= 1
                error = nil
            } catch {
                guard !Task.isCancelled else { return }
                self.error = (error as? APIError)?.message
                    ?? "A new word could not be prepared. Check your connection and try again."
            }
            isReplacing = false
        }
    }

    /// Take a day from the server. A different day (a replacement, or the
    /// morning turning over while the app stayed open) gets a fresh Listen
    /// card - the old narration belongs to the old word - which is Android's
    /// `<ListenCard key={entry.id}>` remount. Either way the card re-reads
    /// status, so a narration finished elsewhere shows up on reopening.
    private func adopt(_ next: DailyCrossEntry) {
        if let entry, Self.identity(entry) != Self.identity(next) {
            listen.reset()
        }
        entry = next
        listen.reference = next.reference
        listen.begin()
    }

    /// What makes two days the same day: the stored row id, or the reference
    /// for an older server that sent none.
    nonisolated static func identity(_ entry: DailyCrossEntry) -> String {
        entry.id ?? entry.reference
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
