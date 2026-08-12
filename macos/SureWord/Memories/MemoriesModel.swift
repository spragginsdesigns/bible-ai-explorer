import Foundation

/// State behind Settings → Memory and the Manage sheet — the Mac counterpart of
/// `mobile/app/(app)/settings.tsx`'s memory card plus
/// `mobile/app/(app)/memories.tsx`.
///
/// One instance is shared by both so the "N saved" count in Settings stays
/// truthful after an add, delete or clear — Android gets the same effect by
/// re-fetching on focus, which a sheet has no equivalent of.
@MainActor
@Observable
final class MemoriesModel {
    enum SummaryState: Equatable {
        case idle
        case loading
        case loaded(summary: MemorySummary?, generatedAt: String?)
        case failed
    }

    struct ErrorAlert: Identifiable, Equatable {
        let id = UUID()
        let title: String
        let message: String
    }

    private(set) var memories: [MemoryRecord] = []
    /// `nil` until the first successful load; the toggle stays disabled while
    /// unknown rather than showing a guess the server never agreed to.
    private(set) var isEnabled: Bool?
    private(set) var hasLoaded = false
    private(set) var loadError: String?
    private(set) var isTogglePending = false
    private(set) var isAdding = false
    private(set) var summaryState: SummaryState = .idle

    var draft = ""
    var errorAlert: ErrorAlert?

    private var api: APIClient?

    /// Views hand over the session's client the first time they appear; the
    /// model is `@State`-owned by `SettingsView`, which cannot read the
    /// environment at init time.
    func configure(_ api: APIClient) {
        if self.api == nil { self.api = api }
    }

    var groups: [MemoryGroup] { MemoryCategory.group(memories) }

    var canAdd: Bool {
        !isAdding && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Loading

    func load() async {
        guard let api else { return }
        do {
            let response = try await api.fetchMemories()
            memories = response.memories
            isEnabled = response.enabled
            loadError = nil
        } catch {
            loadError = Self.message(error, fallback: "Could not load your memories.")
        }
        hasLoaded = true
    }

    // MARK: - Mutations

    /// Optimistic, like Android: the switch moves immediately and rolls back
    /// with an alert if the PATCH fails.
    func setEnabled(_ enabled: Bool) async {
        guard let api, !isTogglePending else { return }
        let previous = isEnabled
        isEnabled = enabled
        isTogglePending = true
        defer { isTogglePending = false }
        do {
            _ = try await api.setMemoryEnabled(enabled)
        } catch {
            isEnabled = previous
            errorAlert = ErrorAlert(
                title: "Could not update memory",
                message: Self.message(error, fallback: "Your setting was not changed. Try again.")
            )
        }
    }

    func add() async {
        guard let api, canAdd else { return }
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        isAdding = true
        defer { isAdding = false }
        do {
            let memory = try await api.addMemory(content: content)
            draft = ""
            memories.insert(memory, at: 0)
            // The stored set changed, so any summary on screen is now stale.
            summaryState = .idle
        } catch {
            errorAlert = ErrorAlert(
                title: "Could not save that memory",
                message: Self.message(error, fallback: "Try again in a moment.")
            )
        }
    }

    func delete(_ memory: MemoryRecord) async {
        guard let api else { return }
        do {
            try await api.deleteMemory(id: memory.id)
            memories.removeAll { $0.id == memory.id }
            summaryState = .idle
        } catch {
            errorAlert = ErrorAlert(
                title: "Could not delete that memory",
                message: Self.message(error, fallback: "Try again in a moment.")
            )
        }
    }

    func clearAll() async {
        guard let api else { return }
        do {
            try await api.clearMemories()
            memories = []
            summaryState = .idle
        } catch {
            errorAlert = ErrorAlert(
                title: "Could not clear your memories",
                message: Self.message(error, fallback: "Try again in a moment.")
            )
        }
    }

    // MARK: - Summary

    /// Only ever called from the button. The endpoint is an LLM call, so it must
    /// not fire on appear — Android is explicit about this and the cost is real.
    func generateSummary() async {
        guard let api, summaryState != .loading else { return }
        summaryState = .loading
        do {
            let response = try await api.generateMemorySummary()
            summaryState = .loaded(summary: response.summary, generatedAt: response.generatedAt)
        } catch {
            summaryState = .failed
            errorAlert = ErrorAlert(
                title: "Could not write the summary",
                message: Self.message(error, fallback: "Try again in a moment.")
            )
        }
    }

    var summaryButtonLabel: String {
        if case .loaded(let summary, _) = summaryState, summary != nil { return "Regenerate" }
        return "Generate summary"
    }

    // MARK: - Helpers

    /// Surfaces the server's own `{ "error": … }` text when there is one, the
    /// way `serverMessage` does on Android.
    private static func message(_ error: any Error, fallback: String) -> String {
        if let apiError = error as? APIError, !apiError.message.isEmpty { return apiError.message }
        let described = error.localizedDescription
        return described.isEmpty ? fallback : described
    }
}
