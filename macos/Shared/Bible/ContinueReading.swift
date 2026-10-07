import Foundation

/// The chapter the Bible home offers to resume: the `lastRead` slice of
/// `GET /api/reading-events` (`src/lib/reading-history.ts`).
struct LastRead: Sendable, Equatable {
    let order: Int
    let bookName: String
    let chapter: Int
    let translation: TranslationID
    let readAt: String

    /// "Judges 7".
    var label: String { "\(bookName) \(chapter)" }

    /// Android's `parseLastRead`, with one deliberate widening: BSB entries
    /// are accepted (PRD C6). Android still rejects them and hides the row
    /// after a BSB read; the server records whatever translation was read.
    /// Fail-soft - anything malformed is nil and the row stays hidden.
    static func parse(_ value: Any?) -> LastRead? {
        guard let object = value as? [String: Any],
              let name = object["book"] as? String,
              let chapterNumber = object["chapter"] as? NSNumber,
              CFGetTypeID(chapterNumber) != CFBooleanGetTypeID(),
              chapterNumber.doubleValue.rounded() == chapterNumber.doubleValue,
              let rawTranslation = object["translation"] as? String,
              let translation = TranslationID(rawValue: rawTranslation),
              let readAt = object["readAt"] as? String,
              let book = Bible.books.first(where: { $0.name == name })
        else { return nil }
        let chapter = chapterNumber.intValue
        guard chapter >= 1, chapter <= book.chapters else { return nil }
        return LastRead(order: book.order, bookName: book.name, chapter: chapter, translation: translation, readAt: readAt)
    }

    /// Parse the whole route body.
    static func parse(response data: Data) -> LastRead? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return parse(object["lastRead"])
    }
}

/// "Continue reading" on the Bible home - `mobile/app/(app)/bible/index.tsx`'s
/// B8 row. Refreshed whenever the home appears or the app returns to the
/// foreground; any failure hides the row rather than showing an error.
@MainActor
@Observable
final class ContinueReadingModel {
    typealias Load = @Sendable () async throws -> Data

    private(set) var lastRead: LastRead?
    private var runID = 0
    private let fetch: Load

    init(fetch: @escaping Load) {
        self.fetch = fetch
    }

    convenience init(api: APIClient) {
        #if DEBUG
        // The simulator evidence harness has no session to read history with.
        if let evidence = Self.evidenceResponse {
            self.init(fetch: { evidence })
            return
        }
        #endif
        self.init(fetch: { try await api.data("/api/reading-events") })
    }

    #if DEBUG
    /// Debug-only canned `/api/reading-events` body for `UIEvidenceHarness`.
    static var evidenceResponse: Data?
    #endif

    func refresh() async {
        runID += 1
        let id = runID
        let value: LastRead?
        do {
            value = LastRead.parse(response: try await fetch())
        } catch {
            value = nil
        }
        guard id == runID else { return }
        lastRead = value
    }
}
