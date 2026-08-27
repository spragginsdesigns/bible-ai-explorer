import Foundation

/// State behind Settings -> My church, the Apple counterpart of
/// `mobile/src/features/church/churchStore.ts` and the web's
/// `src/components/settings/ChurchSection.tsx`.
///
/// One instance per Settings screen. The view stays presentational: every
/// network call, the search debounce and the stale-response guard live here.
@MainActor
@Observable
final class ChurchModel {
    /// How the section as a whole should render. `.unavailable` means the
    /// server has no Places key, and the section is not drawn at all.
    enum LoadState: Equatable { case loading, unavailable, failed, ready }

    struct ErrorAlert: Identifiable, Equatable {
        let id = UUID()
        let title: String
        let message: String
    }

    private(set) var state: LoadState = .loading
    private(set) var church: ChurchProfile?
    /// True while the picker is open: no church saved, or "Change church" hit.
    private(set) var isPicking = false
    private(set) var results: [ChurchSearchResult] = []
    /// A search is in flight, or still debouncing, for the current query.
    private(set) var isSearchPending = false
    private(set) var searchError: String?
    /// The result being saved, so only its row shows a spinner.
    private(set) var savingPlaceId: String?
    private(set) var isRemoving = false

    var query = ""
    var errorAlert: ErrorAlert?

    private var api: APIClient?
    private var searchTask: Task<Void, Never>?
    /// Monotonic id of the newest search; older responses are dropped.
    private var searchRequestId = 0

    /// Views hand over the session's client the first time they appear; the
    /// model is `@State`-owned by `SettingsView`, which cannot read the
    /// environment at init time.
    func configure(_ api: APIClient) {
        if self.api == nil { self.api = api }
    }

    var isSaving: Bool { savingPlaceId != nil }

    /// The picker only offers Cancel when there is a saved church to go back to.
    var canCancelPicking: Bool { church != nil }

    /// Web shows this nudge below the minimum; Android simply searches nothing.
    var showsKeepTypingHint: Bool {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && !ChurchRules.shouldSearch(trimmed)
    }

    var showsNoResultsHint: Bool {
        !isSaving && !isSearchPending && searchError == nil && results.isEmpty
            && ChurchRules.shouldSearch(query)
    }

    // MARK: - Loading

    func load() async {
        guard let api else { return }
        state = .loading
        do {
            switch try await api.fetchChurch() {
            case .unavailable:
                state = .unavailable
            case .ok(let church):
                self.church = church
                isPicking = church == nil
                state = .ready
            }
        } catch {
            state = .failed
        }
    }

    // MARK: - Search

    /// Called on every keystroke. Cancels the pending debounce, bumps the
    /// request id so any response already in flight is discarded, and starts a
    /// fresh timer.
    func queryChanged() {
        searchTask?.cancel()
        searchRequestId += 1

        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard ChurchRules.shouldSearch(trimmed) else {
            results = []
            isSearchPending = false
            searchError = nil
            return
        }

        isSearchPending = true
        searchError = nil
        let requestId = searchRequestId
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(ChurchRules.searchDebounceMilliseconds))
            if Task.isCancelled { return }
            await self?.runSearch(trimmed, requestId: requestId)
        }
    }

    private func runSearch(_ query: String, requestId: Int) async {
        guard let api else { return }
        do {
            let response = try await api.searchChurches(query: query)
            guard ChurchRules.isLatestRequest(requestId, latest: searchRequestId) else { return }
            switch response {
            case .unavailable:
                state = .unavailable
            case .ok(let results):
                self.results = results
            }
        } catch {
            guard ChurchRules.isLatestRequest(requestId, latest: searchRequestId) else { return }
            results = []
            // Inline, not an alert: search runs per keystroke, and a flaky
            // connection would otherwise stack modal dialogs.
            searchError = Self.message(error, fallback: "Couldn't search for churches. Try again.")
        }
        if ChurchRules.isLatestRequest(requestId, latest: searchRequestId) {
            isSearchPending = false
        }
    }

    func clearQuery() {
        query = ""
        searchError = nil
        queryChanged()
    }

    // MARK: - Mutations

    func pick(_ placeId: String) async {
        guard let api, savingPlaceId == nil else { return }
        savingPlaceId = placeId
        defer { savingPlaceId = nil }
        do {
            switch try await api.saveChurch(placeId: placeId) {
            case .unavailable:
                state = .unavailable
            case .ok(let church):
                self.church = church
                isPicking = church == nil
                resetSearch()
            }
        } catch {
            let apiError = error as? APIError
            errorAlert = ErrorAlert(
                title: "Could not save that church",
                message: apiError?.status == 404
                    ? "Couldn't load that church, try another result."
                    : Self.message(error, fallback: "Try again in a moment.")
            )
        }
    }

    func startChange() {
        isPicking = true
        resetSearch()
    }

    /// Only offered while a church is saved, so cancelling returns to its card.
    func cancelChange() {
        guard church != nil else { return }
        isPicking = false
        resetSearch()
    }

    func remove() async {
        guard let api, !isRemoving else { return }
        isRemoving = true
        defer { isRemoving = false }
        do {
            try await api.removeChurch()
            church = nil
            isPicking = true
            resetSearch()
        } catch {
            errorAlert = ErrorAlert(
                title: "Could not remove your church",
                message: Self.message(error, fallback: "Try again in a moment.")
            )
        }
    }

    // MARK: - Helpers

    private func resetSearch() {
        searchTask?.cancel()
        searchRequestId += 1
        query = ""
        results = []
        searchError = nil
        isSearchPending = false
    }

    /// Surfaces the server's own `{ "error": ... }` text when there is one, the
    /// way `serverMessage` does on Android.
    private static func message(_ error: any Error, fallback: String) -> String {
        if let apiError = error as? APIError, !apiError.message.isEmpty { return apiError.message }
        let described = error.localizedDescription
        return described.isEmpty ? fallback : described
    }
}
