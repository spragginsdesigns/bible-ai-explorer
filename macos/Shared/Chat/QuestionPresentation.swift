import Foundation

/// Presentation for the opening "Questions for your study" chips.
///
/// Port of `src/utils/questionPresentation.ts`, mirrored on Android as
/// `mobile/src/features/chat/questionPresentation.ts`. Every chip carries a
/// small gold label: a Scripture reference when the question is anchored to
/// one, otherwise the source it was drawn from ("YOUR NOTES", "TODAY'S VERSE",
/// and so on). The server supplies the label; the regex below is only the
/// fallback for a missing one - a set stored before labels existed, or a client
/// talking to an older deploy.
///
/// The pure rules are covered by `SureWordTests/QuestionPresentationTests.swift`,
/// which mirrors `mobile/src/features/chat/questionPresentation.test.ts`.

/// One question as the API delivers it. `label` is absent on older payloads.
struct SuggestedQuestionInput: Equatable, Sendable {
    var question: String
    var label: String?
}

/// One chip, ready to render.
struct SuggestedQuestionItem: Equatable, Identifiable, Sendable {
    /// Index-prefixed so two identical questions stay distinct rows.
    var key: String
    var question: String
    /// Upper-case, ready for the gold slot. Nil when nothing applies.
    var label: String?

    var id: String { key }
}

enum QuestionPresentation {

    private static let enDash = "\u{2013}"

    private static let bibleBook =
        "(?:[1-3]\\s*)?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth"
        + "|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes"
        + "|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos"
        + "|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew"
        + "|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians"
        + "|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude"
        + "|Revelation)"

    // Book, then a chapter or chapter range, then optionally a verse or range.
    // `[0-9]` rather than `\d`: ICU's `\d` is every Unicode decimal digit, while
    // the JS original is ASCII-only.
    private static let referenceBody =
        bibleBook + "\\s+[0-9]+(?:[-\u{2013}][0-9]+)?(?::[0-9]+(?:[-\u{2013}][0-9]+)?)?"

    private static func makeRegex(_ pattern: String) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }

    // `\A`/`\z` rather than `^`/`$`: ICU's `$` also matches before a final line
    // terminator, which JS's does not without the `m` flag.
    nonisolated(unsafe) private static let scriptureReference =
        makeRegex("\\b(" + referenceBody + ")")
    nonisolated(unsafe) private static let scriptureReferenceExact =
        makeRegex("\\A" + referenceBody + "\\z")

    /// "of" in "Song of Solomon" stays lower - every other word is capitalized.
    private static let lowercaseWords: Set<String> = ["of"]

    /// Canonical display form: "1 samuel 3:1-10" becomes "1 Samuel 3:1-10".
    private static func normalizeReferenceText(_ raw: String) -> String {
        var scalars: [Unicode.Scalar] = []
        var pendingSpace = false
        var started = false
        for scalar in raw.unicodeScalars {
            if Character(scalar).isWhitespace {
                if started { pendingSpace = true }
                continue
            }
            if pendingSpace {
                scalars.append(" ")
                pendingSpace = false
            }
            scalars.append(scalar == "-" ? "\u{2013}" : scalar)
            started = true
        }

        // `/^([1-3])\s*/ → "$1 "`: the whitespace run is already collapsed, so
        // this only has to insert the space a bare "1samuel" is missing.
        if let first = scalars.first, first == "1" || first == "2" || first == "3" {
            if scalars.count == 1 {
                scalars.append(" ")
            } else if scalars[1] != " " {
                scalars.insert(" ", at: 1)
            }
        }

        // `/[A-Za-z]+/g` with the match offset deciding whether "of" stays low.
        var out: [Unicode.Scalar] = []
        var index = 0
        while index < scalars.count {
            guard isASCIILetter(scalars[index]) else {
                out.append(scalars[index])
                index += 1
                continue
            }
            var end = index
            while end < scalars.count, isASCIILetter(scalars[end]) { end += 1 }
            let word = String(String.UnicodeScalarView(scalars[index..<end])).lowercased()
            if index > 0, lowercaseWords.contains(word) {
                out.append(contentsOf: word.unicodeScalars)
            } else {
                out.append(contentsOf: (word.prefix(1).uppercased() + word.dropFirst()).unicodeScalars)
            }
            index = end
        }
        return String(String.UnicodeScalarView(out))
    }

    private static func isASCIILetter(_ scalar: Unicode.Scalar) -> Bool {
        (scalar >= "A" && scalar <= "Z") || (scalar >= "a" && scalar <= "z")
    }

    /// Pull a real reference from the question text without inventing one.
    static func questionReference(_ question: String) -> String? {
        guard let scriptureReference else { return nil }
        let text = question as NSString
        guard let match = scriptureReference.firstMatch(
            in: question, range: NSRange(location: 0, length: text.length)
        ) else { return nil }
        let group = match.range(at: 1)
        guard group.location != NSNotFound else { return nil }
        return normalizeReferenceText(text.substring(with: group))
    }

    /// A label meant to BE a reference - the whole label must parse as one.
    static func parseReferenceLabel(_ label: String) -> String? {
        guard let scriptureReferenceExact else { return nil }
        let trimmed = collapseWhitespace(label)
        let text = trimmed as NSString
        let matched = scriptureReferenceExact.firstMatch(
            in: trimmed, range: NSRange(location: 0, length: text.length)
        ) != nil
        return matched ? normalizeReferenceText(trimmed) : nil
    }

    /// `label.trim().replace(/\s+/g, " ")`.
    private static func collapseWhitespace(_ text: String) -> String {
        var scalars: [Unicode.Scalar] = []
        var pendingSpace = false
        var started = false
        for scalar in text.unicodeScalars {
            if Character(scalar).isWhitespace {
                if started { pendingSpace = true }
                continue
            }
            if pendingSpace {
                scalars.append(" ")
                pendingSpace = false
            }
            scalars.append(scalar)
            started = true
        }
        return String(String.UnicodeScalarView(scalars))
    }

    /// Preserve every generated question, in order, while adding
    /// presentation-only metadata.
    static func buildItems(_ questions: [SuggestedQuestionInput]) -> [SuggestedQuestionItem] {
        questions.enumerated().map { index, entry in
            let supplied = entry.label.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            let label: String?
            if let supplied, !supplied.isEmpty {
                label = supplied
            } else {
                label = questionReference(entry.question)
            }
            return SuggestedQuestionItem(
                key: "\(index):\(entry.question)",
                question: entry.question,
                label: label?.uppercased()
            )
        }
    }

    /// Convenience for the static six, which carry no server label.
    static func buildItems(_ questions: [String]) -> [SuggestedQuestionItem] {
        buildItems(questions.map { SuggestedQuestionInput(question: $0, label: nil) })
    }
}
