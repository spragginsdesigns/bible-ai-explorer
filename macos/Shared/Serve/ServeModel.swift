import Foundation

/// State behind Ways to Serve on both Apple platforms: the Today card, the
/// page itself and the Settings row all read this one instance (owned by
/// `AppModel`), so a mode change in Settings hides the Today card at once.
@MainActor
@Observable
final class ServeModel {
    enum LoadState: Equatable { case idle, loading, failed, ready }

    enum NearbyState: Equatable {
        case idle
        case searching
        case results([ServePlace])
        case unavailable
        case failed(String)
    }

    struct ErrorAlert: Identifiable, Equatable {
        let id = UUID()
        let title: String
        let message: String
    }

    private(set) var state: LoadState = .idle
    private(set) var view: ServeView?
    private(set) var entries: [ServeEntry] = []
    private(set) var entriesLoaded = false
    private(set) var isSavingEntry = false
    private(set) var nearby: NearbyState = .idle
    /// The search chip last used, so its chip reads as selected.
    private(set) var nearbyKind: String?

    var location = ""
    var draft = ""
    /// The verse of the way that opened the journal, saved with the entry.
    var journalVerse: String?
    var errorAlert: ErrorAlert?

    private let api: APIClient
    /// Bumped by every settings write, so only the newest PATCH may apply its
    /// answer or roll back: a slow first answer must not undo a second choice.
    private var settingsRevision = 0
    private var nearbyRequest = 0

    init(api: APIClient) {
        self.api = api
    }

    var mode: ServeMode { view?.settings.mode ?? ServeMode.defaultMode }

    /// The Today card shows only with a loaded view, a mode other than off,
    /// and a suggestion for today.
    var todayCardWay: ServeWay? {
        guard let view, view.settings.mode != .off else { return nil }
        return view.today
    }

    // MARK: - Loading

    /// Keeps whatever is on screen when a refresh fails; only a first load
    /// with nothing to show reports the failure.
    func refresh() async {
        if view == nil { state = .loading }
        let revision = settingsRevision
        do {
            let fresh = try await api.fetchServe()
            // A settings write that started meanwhile owns the answer.
            guard revision == settingsRevision else { return }
            view = fresh
            state = .ready
        } catch {
            if view == nil { state = .failed }
        }
    }

    func loadEntries() async {
        do {
            entries = try await api.fetchServeEntries()
            entriesLoaded = true
        } catch {
            // The journal is secondary to the page; an empty list with the
            // editor still usable is better than an alert on every open.
            entriesLoaded = true
        }
    }

    // MARK: - Settings (optimistic)

    func setMode(_ mode: ServeMode) async {
        guard let current = view, current.settings.mode != mode else { return }
        var optimistic = current
        optimistic.settings.mode = mode
        await write(optimistic, rollback: current) { [api] in try await api.updateServe(mode: mode) }
    }

    func setGivesToChurch(_ gives: Bool) async {
        guard let current = view, current.settings.givesToChurch != gives else { return }
        var optimistic = current
        optimistic.settings.givesToChurch = gives
        await write(optimistic, rollback: current) { [api] in try await api.updateServe(givesToChurch: gives) }
    }

    private func write(
        _ optimistic: ServeView,
        rollback: ServeView,
        request: @escaping @MainActor () async throws -> ServeView
    ) async {
        settingsRevision += 1
        let revision = settingsRevision
        view = optimistic
        do {
            let fresh = try await request()
            guard revision == settingsRevision else { return }
            view = fresh
            if fresh.settings.mode == .off || !fresh.nearby.available { nearby = .idle }
        } catch {
            guard revision == settingsRevision else { return }
            view = rollback
            errorAlert = ErrorAlert(
                title: "Could not save that",
                message: Self.message(error, fallback: "Try again in a moment.")
            )
        }
    }

    // MARK: - Nearby

    var canSearchNearby: Bool { ServeRules.cleanLocation(location) != nil }

    func searchNearby(kind: String) async {
        guard let place = ServeRules.cleanLocation(location) else { return }
        nearbyRequest += 1
        let request = nearbyRequest
        nearbyKind = kind
        nearby = .searching
        do {
            let response = try await api.searchServeNearby(location: place, kind: kind)
            guard request == nearbyRequest else { return }
            switch response {
            case .unavailable: nearby = .unavailable
            case .ok(let results): nearby = .results(results)
            }
        } catch {
            guard request == nearbyRequest else { return }
            nearby = .failed(Self.message(error, fallback: "Search failed. Try again."))
        }
    }

    // MARK: - Journal

    var canSaveEntry: Bool { !isSavingEntry && ServeRules.cleanEntry(draft) != nil }

    func saveEntry() async {
        guard !isSavingEntry, let text = ServeRules.cleanEntry(draft) else { return }
        isSavingEntry = true
        defer { isSavingEntry = false }
        do {
            let entry = try await api.addServeEntry(text: text, verseRef: journalVerse)
            journalVerse = nil
            entries.insert(entry, at: 0)
            // Only clear what was saved; anything typed meanwhile stays.
            if draft.trimmingCharacters(in: .whitespacesAndNewlines) == text { draft = "" }
        } catch {
            errorAlert = ErrorAlert(
                title: "Could not save that",
                message: Self.message(error, fallback: "Try again in a moment.")
            )
        }
    }

    func deleteEntry(_ id: String) async {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        let removed = entries.remove(at: index)
        do {
            try await api.deleteServeEntry(id: id)
        } catch {
            // A 404 means it is already gone, which is what was asked for.
            if (error as? APIError)?.status == 404 { return }
            entries.insert(removed, at: min(index, entries.count))
            errorAlert = ErrorAlert(
                title: "Could not delete that",
                message: Self.message(error, fallback: "Try again in a moment.")
            )
        }
    }

    private static func message(_ error: any Error, fallback: String) -> String {
        if let apiError = error as? APIError, !apiError.message.isEmpty { return apiError.message }
        let described = error.localizedDescription
        return described.isEmpty ? fallback : described
    }
}
