import Foundation
import SwiftUI

/// Verse highlights (YouVersion-style), backed by `/api/highlights` and a JSON
/// disk cache in Application Support, following `NotesStore`'s pattern: a
/// re-opened chapter paints its highlights from disk instantly and revalidates
/// silently against the server.
///
/// The whole map lives in one dictionary keyed `"translation:book:chapter:verse"`
/// → `"#RRGGBB"`. `BibleModel.load` refreshes the current chapter after the
/// text lands; the readers read through `hex(...)`/`color(...)`.
@MainActor
@Observable
final class HighlightsStore {
    private(set) var colors: [String: String] = [:]
    /// True once the persisted cache has been read, or found absent.
    private(set) var isHydrated = false

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let cacheURL: URL?
    @ObservationIgnored private var hydrateTask: Task<Void, Never>?

    /// `cacheURL: nil` keeps the store entirely in memory, which is what the
    /// unit tests use.
    init(api: APIClient, cacheURL: URL?) {
        self.api = api
        self.cacheURL = cacheURL
    }

    static func key(translation: TranslationID, book: Int, chapter: Int, verse: Int) -> String {
        "\(translation.rawValue):\(book):\(chapter):\(verse)"
    }

    func hex(translation: TranslationID, book: Int, chapter: Int, verse: Int) -> String? {
        colors[Self.key(translation: translation, book: book, chapter: chapter, verse: verse)]
    }

    func color(translation: TranslationID, book: Int, chapter: Int, verse: Int) -> Color? {
        hex(translation: translation, book: book, chapter: chapter, verse: verse)
            .flatMap { Color(hex: $0) }
    }

    // MARK: - Persistence

    private struct Payload: Codable {
        var colors: [String: String]
    }

    static var defaultCacheURL: URL? {
        guard
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        else { return nil }
        let directory = base.appendingPathComponent("SureWord", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("highlights-cache.v1.json")
    }

    /// Read the persisted cache exactly once per app run.
    func hydrate() async {
        if let hydrateTask {
            await hydrateTask.value
            return
        }
        let task = Task { @MainActor in
            defer { isHydrated = true }
            guard let cacheURL, let data = try? Data(contentsOf: cacheURL) else { return }
            guard let payload = try? JSONDecoder().decode(Payload.self, from: data) else {
                // A corrupt cache must not block a network load.
                return
            }
            colors = payload.colors
        }
        hydrateTask = task
        await task.value
    }

    private func persist() {
        guard let cacheURL else { return }
        let payload = Payload(colors: colors)
        guard let data = try? JSONEncoder().encode(payload) else { return }
        // A full or unwritable disk must never break the UI, so the failure is
        // swallowed rather than surfaced — the cache is an optimisation.
        try? data.write(to: cacheURL, options: .atomic)
    }

    // MARK: - Loading

    private struct ChapterHighlights: Decodable {
        let highlights: [Entry]
    }

    private struct Entry: Decodable {
        let verse: Int
        let color: String
    }

    /// Fetch one chapter's highlights and replace that chapter's slice of the
    /// cache with them. Other chapters keep their cached entries, and a failed
    /// fetch leaves the cache alone — highlights must never surface an error
    /// in the reader.
    func refresh(translation: TranslationID, book: Int, chapter: Int) async {
        await hydrate()
        let prefix = "\(translation.rawValue):\(book):\(chapter):"
        do {
            let response: ChapterHighlights = try await api.json(
                "/api/highlights?translation=\(translation.rawValue)&book=\(book)&chapter=\(chapter)"
            )
            guard !Task.isCancelled else { return }
            colors = colors.filter { !$0.key.hasPrefix(prefix) }
            for entry in response.highlights {
                colors["\(prefix)\(entry.verse)"] = entry.color
            }
            persist()
        } catch {
            // Offline or server trouble: the cached colours stay on screen.
        }
    }

    // MARK: - Mutations

    private struct SetBody: Encodable {
        let translation: String
        let book: Int
        let chapter: Int
        let verse: Int
        let color: String
    }

    private struct RemoveBody: Encodable {
        let translation: String
        let book: Int
        let chapter: Int
        let verse: Int
    }

    /// Optimistic: paint immediately and persist, then upsert on the server.
    /// A failure rolls the verse back to whatever it was — unless a newer
    /// change has already superseded this one.
    func setColor(translation: TranslationID, book: Int, chapter: Int, verse: Int, hex: String) {
        let key = Self.key(translation: translation, book: book, chapter: chapter, verse: verse)
        let previous = colors[key]
        colors[key] = hex
        persist()
        Task { [api] in
            do {
                try await api.data(
                    "/api/highlights",
                    method: "PUT",
                    body: SetBody(
                        translation: translation.rawValue,
                        book: book,
                        chapter: chapter,
                        verse: verse,
                        color: hex
                    )
                )
            } catch {
                guard colors[key] == hex else { return }
                colors[key] = previous
                persist()
            }
        }
    }

    /// Optimistic remove, same rollback rules as `setColor`.
    func remove(translation: TranslationID, book: Int, chapter: Int, verse: Int) {
        let key = Self.key(translation: translation, book: book, chapter: chapter, verse: verse)
        guard let previous = colors[key] else { return }
        colors[key] = nil
        persist()
        Task { [api] in
            do {
                try await api.data(
                    "/api/highlights",
                    method: "DELETE",
                    body: RemoveBody(
                        translation: translation.rawValue,
                        book: book,
                        chapter: chapter,
                        verse: verse
                    )
                )
            } catch {
                guard colors[key] == nil else { return }
                colors[key] = previous
                persist()
            }
        }
    }

    /// Test seam: drop everything without touching disk semantics.
    func reset() {
        colors = [:]
    }

    /// Drop everything **including the file on disk** - highlights belong to an
    /// account, so a user switch must not leave the last one's colours behind
    /// for the next `hydrate()` to read back.
    func clearCache() {
        reset()
        guard let cacheURL else { return }
        try? FileManager.default.removeItem(at: cacheURL)
    }
}
