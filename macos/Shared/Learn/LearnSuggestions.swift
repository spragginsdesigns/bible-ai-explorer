import Foundation

/// Verses SureWord suggests you learn: the client half of
/// `GET /api/learn/suggestions` - a port of
/// `mobile/src/features/learn/suggestions.ts`.
///
/// The server decides what to suggest and why; this decides what the screen
/// shows. Rows are dropped one at a time rather than failing the section,
/// because suggestions sit beside today's practice and must never take the
/// practice screen down with them.
struct LearnSuggestion: Equatable, Sendable, Identifiable {
    let book: Int
    let chapter: Int
    let verse: Int
    let reference: String
    let text: String
    let reason: String
    let weight: Double
    let source: String

    var id: String { LearnSuggestions.key(book: book, chapter: chapter, verse: verse) }
}

struct LearnSuggestionsView: Equatable, Sendable {
    let rows: [LearnSuggestion]
    /// Nothing is due, so the suggestions are the screen's content.
    let lead: Bool
    /// Nothing is due and nothing to suggest: the existing empty copy applies.
    let showEmptyText: Bool
    let heading: String
}

enum LearnSuggestions {
    static let limit = 5
    static let heading = "Suggested for you"
    static let lead = "Verses worth knowing, from what you have been reading."
    static let sources = ["highlight", "reading", "chat", "cross", "note"]

    static func key(book: Int, chapter: Int, verse: Int) -> String {
        "\(book):\(chapter):\(verse)"
    }

    /// `parseSuggestions`: the rows the contract describes, in arrival order,
    /// one per verse, at most `limit`.
    static func parse(_ value: JSONValue?) -> [LearnSuggestion] {
        guard let rows = value?["suggestions"]?.arrayValue else { return [] }
        var seen = Set<String>()
        var suggestions: [LearnSuggestion] = []
        for row in rows {
            guard let suggestion = suggestion(row) else { continue }
            guard seen.insert(suggestion.id).inserted else { continue }
            suggestions.append(suggestion)
            if suggestions.count == limit { break }
        }
        return suggestions
    }

    private static func coordinate(_ value: JSONValue?, max: Int) -> Int? {
        guard let number = value?.doubleValue, number.rounded() == number,
              number >= 1, number <= Double(max) else { return nil }
        return Int(number)
    }

    private static func sentence(_ value: JSONValue?) -> String? {
        guard let text = value?.stringValue,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }

    private static func suggestion(_ row: JSONValue) -> LearnSuggestion? {
        guard let book = coordinate(row["book"], max: 66),
              let chapter = coordinate(row["chapter"], max: 200),
              let verse = coordinate(row["verse"], max: 200),
              let reference = sentence(row["reference"]),
              let text = sentence(row["text"]),
              let reason = sentence(row["reason"]),
              let weight = row["weight"]?.doubleValue, weight.isFinite, weight >= 0,
              let source = row["source"]?.stringValue, sources.contains(source)
        else { return nil }
        return LearnSuggestion(
            book: book,
            chapter: chapter,
            verse: verse,
            reference: reference,
            text: text,
            reason: reason,
            weight: weight,
            source: source
        )
    }

    static func view(
        suggestions: [LearnSuggestion],
        dismissed: Set<String>,
        added: Set<String>,
        hasCard: Bool
    ) -> LearnSuggestionsView {
        let rows = suggestions.filter { !dismissed.contains($0.id) && !added.contains($0.id) }
        let lead = !hasCard && !rows.isEmpty
        return LearnSuggestionsView(
            rows: rows,
            lead: lead,
            showEmptyText: !hasCard && rows.isEmpty,
            heading: lead ? Self.lead : Self.heading
        )
    }

    /// The line that stands in for the row once it has been added.
    static func addedConfirmation(_ reference: String) -> String {
        "Added \(reference) to Learn."
    }
}
