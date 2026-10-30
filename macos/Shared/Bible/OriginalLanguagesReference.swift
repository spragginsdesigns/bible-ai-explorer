import Foundation

/// Study's reference field follows Android's `wordStudyHandoff`: a range
/// opens its first verse, and that verse must have nonblank bundled KJV text.
/// Parsing alone checks chapter bounds, but permits a verse beyond its end.
enum OriginalLanguagesReference {
    /// A fresh identity also lets submitting the same query retry validation.
    struct Request: Equatable, Sendable {
        let id = UUID()
        let query: String
    }

    typealias Chapter = @Sendable (_ order: Int, _ chapter: Int) async throws -> [String]

    static func resolve(
        _ query: String,
        chapter: Chapter = { try await KJVLibrary.shared.chapter(order: $0, chapter: $1) }
    ) async -> ConnectionsPlace? {
        guard !Task.isCancelled,
              let reference = Bible.resolveReference(query), let verse = reference.verse,
              let verses = try? await chapter(reference.order, reference.chapter),
              !Task.isCancelled,
              verses.indices.contains(verse - 1),
              !verses[verse - 1].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return ConnectionsPlace(order: reference.order, chapter: reference.chapter, verse: verse)
    }
}
