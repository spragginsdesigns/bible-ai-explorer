import Foundation

/// Pure chapter-to-note matcher for the Bible reader ("My Study" loop),
/// mirroring `src/lib/bible/chapterNotes.ts` and `mobile/src/features/bible/chapterNotes.ts`.
struct ChapterNoteSummary: Sendable, Equatable {
    let id: String
    let title: String
    let plainText: String?
    let updatedAt: String
}

struct ChapterNotesContext: Sendable, Equatable {
    let bookName: String
    var bookAbbr: String? = nil
    let chapter: Int
    var verseCount: Int = 200
}

struct MatchedChapterNote: Identifiable, Sendable, Equatable {
    let id: String
    let title: String
    let excerpt: String
    let updatedAt: String
    let verses: [Int]
    let chapterLevel: Bool
}

enum ChapterNotes {
    private static let extraBookStems: [String: [String]] = [
        "Exodus": ["Exod", "Ex"],
        "Psalms": ["Psalm", "Ps"],
        "Ecclesiastes": ["Eccles", "Eccl"],
        "Song of Solomon": ["Song of Songs", "Song"],
        "Obadiah": ["Obad", "Ob"],
        "Matthew": ["Matt"],
        "Mark": ["Mk"],
        "Luke": ["Lk"],
        "John": ["Jn"],
        "1 John": ["1 Jn", "1Jn"],
        "2 John": ["2 Jn", "2Jn"],
        "3 John": ["3 Jn", "3Jn"],
        "Titus": ["Tit"],
    ]

    private static func buildBookPattern(bookName: String, bookAbbr: String?) -> String {
        var rawStems: Set<String> = [bookName.trimmingCharacters(in: .whitespacesAndNewlines)]
        if let abbr = bookAbbr?.trimmingCharacters(in: .whitespacesAndNewlines), !abbr.isEmpty {
            let clean = abbr.hasSuffix(".") ? String(abbr.dropLast()) : abbr
            if !clean.isEmpty { rawStems.insert(clean) }
        }
        for extra in extraBookStems[bookName] ?? [] {
            rawStems.insert(extra)
        }
        let sorted = rawStems.filter { !$0.isEmpty }.sorted { $0.count > $1.count }
        let patterns: [String] = sorted.map { stem in
            if stem.count > 2,
               let first = stem.first,
               ["1", "2", "3"].contains(first),
               stem.dropFirst().first == " " {
                let rest = String(stem.dropFirst(2))
                let escaped = NSRegularExpression.escapedPattern(for: rest)
                    .replacingOccurrences(of: " ", with: "\\s+")
                return "\(first)\\s*\(escaped)"
            }
            return NSRegularExpression.escapedPattern(for: stem)
                .replacingOccurrences(of: " ", with: "\\s+")
        }
        return "(?:\(patterns.joined(separator: "|")))"
    }

    private static func isPrecededByVolumeDigit(_ text: NSString, at matchIndex: Int) -> Bool {
        var i = matchIndex - 1
        while i >= 0 {
            let c = text.character(at: i)
            if c == 32 || c == 9 {
                i -= 1
            } else {
                break
            }
        }
        guard i >= 0 else { return false }
        let ch = text.character(at: i)
        guard ch == 49 || ch == 50 || ch == 51 else { return false } // '1', '2', '3'
        if i == 0 { return true }
        let prev = text.character(at: i - 1)
        let isAlphaNum = (prev >= 48 && prev <= 57) || (prev >= 65 && prev <= 90) || (prev >= 97 && prev <= 122)
        return !isAlphaNum
    }

    private static func buildExcerpt(title: String, plainText: String?) -> String {
        let raw = (plainText ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return "" }
        let lines = raw
            .components(separatedBy: .newlines)
            .map { line -> String in
                var trimmed = line.trimmingCharacters(in: .whitespaces)
                while trimmed.hasPrefix(">") {
                    trimmed = String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)
                }
                return trimmed
            }
            .filter { !$0.isEmpty }
        let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let bodyLines = (lines.count > 1 && lines[0].lowercased() == normalizedTitle)
            ? Array(lines.dropFirst())
            : lines
        let joined = bodyLines
            .joined(separator: " ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if joined.count <= 140 { return joined }
        let prefix = String(joined.prefix(137)).trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(prefix)…"
    }

    static func matchChapterNotes(
        notes: [ChapterNoteSummary],
        context: ChapterNotesContext
    ) -> [MatchedChapterNote] {
        let trimmedBook = context.bookName.trimmingCharacters(in: .whitespacesAndNewlines)
        let maxVerse = context.verseCount > 0 ? context.verseCount : 200
        guard !trimmedBook.isEmpty, context.chapter >= 1 else { return [] }

        let isNumberedBook = trimmedBook.range(of: "^[123]\\s", options: .regularExpression) != nil
        let bookAlt = buildBookPattern(bookName: trimmedBook, bookAbbr: context.bookAbbr)

        let versePattern = "(?<![A-Za-z0-9])(\(bookAlt))\\.?\\s+\(context.chapter):(\\d{1,3})(?:\\s*[-\\u2013\\u2014]\\s*(\\d{1,3})(?::(\\d{1,3}))?)?(?!\\d)(?!:\\d)"
        let chapterTitlePattern = "(?<![A-Za-z0-9])(\(bookAlt))\\.?\\s+\(context.chapter)(?!\\d)(?!\\s*:\\s*\\d)"

        guard
            let verseRegex = try? NSRegularExpression(pattern: versePattern, options: [.caseInsensitive]),
            let chapterTitleRegex = try? NSRegularExpression(pattern: chapterTitlePattern, options: [.caseInsensitive])
        else {
            return []
        }

        var results: [MatchedChapterNote] = []

        for note in notes {
            var verseSet = Set<Int>()
            let combined = "\(note.title)\n\(note.plainText ?? "")"
            let nsCombined = combined as NSString
            let fullRange = NSRange(location: 0, length: nsCombined.length)

            for match in verseRegex.matches(in: combined, options: [], range: fullRange) {
                if !isNumberedBook && isPrecededByVolumeDigit(nsCombined, at: match.range.location) {
                    continue
                }
                let startStr = nsCombined.substring(with: match.range(at: 2))
                guard let startVerse = Int(startStr), startVerse >= 1, startVerse <= maxVerse else {
                    continue
                }
                let rangeSecond: Int? = match.range(at: 3).location != NSNotFound
                    ? Int(nsCombined.substring(with: match.range(at: 3)))
                    : nil
                let crossChapterVerse: Int? = match.range(at: 4).location != NSNotFound
                    ? Int(nsCombined.substring(with: match.range(at: 4)))
                    : nil

                var endVerse = startVerse
                if let second = rangeSecond, crossChapterVerse == nil, second >= startVerse {
                    endVerse = min(second, maxVerse, startVerse + 50)
                }
                for v in startVerse...endVerse {
                    verseSet.insert(v)
                }
            }

            var chapterLevel = false
            let nsTitle = note.title as NSString
            let titleRange = NSRange(location: 0, length: nsTitle.length)
            for titleMatch in chapterTitleRegex.matches(in: note.title, options: [], range: titleRange) {
                if !isNumberedBook && isPrecededByVolumeDigit(nsTitle, at: titleMatch.range.location) {
                    continue
                }
                chapterLevel = true
                break
            }

            if verseSet.isEmpty && !chapterLevel { continue }

            results.append(
                MatchedChapterNote(
                    id: note.id,
                    title: note.title.isEmpty ? "Untitled Note" : note.title,
                    excerpt: buildExcerpt(title: note.title, plainText: note.plainText),
                    updatedAt: note.updatedAt,
                    verses: verseSet.sorted(),
                    chapterLevel: chapterLevel
                )
            )
        }

        return results.sorted { $0.updatedAt > $1.updatedAt }
    }

    static func versesWithNotes(_ matches: [MatchedChapterNote]) -> Set<Int> {
        var set = Set<Int>()
        for note in matches {
            for v in note.verses { set.insert(v) }
        }
        return set
    }

    static func notesForSelection(
        _ matches: [MatchedChapterNote],
        selection: VerseSelection?
    ) -> [MatchedChapterNote] {
        guard let selection else { return [] }
        let start = min(selection.start, selection.end)
        let end = max(selection.start, selection.end)
        var verseMatches: [MatchedChapterNote] = []
        var chapterMatches: [MatchedChapterNote] = []
        for note in matches {
            if note.verses.contains(where: { $0 >= start && $0 <= end }) {
                verseMatches.append(note)
            } else if note.chapterLevel {
                chapterMatches.append(note)
            }
        }
        return verseMatches + chapterMatches
    }
}
