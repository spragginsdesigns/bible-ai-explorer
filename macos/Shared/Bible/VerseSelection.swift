import Foundation

/// Verse selection for the reader's verse sheet: one verse, or a contiguous
/// range grown by tapping more verses while the sheet is open (the YouVersion
/// model).
///
/// Port of `mobile/src/features/bible/verseSelection.ts` (and its byte-for-byte
/// web twin `src/lib/bible/verseSelection.ts`). The rules are the contract the
/// sheets on every client rely on, so they are pure functions here too and
/// `VerseSelectionTests` replays `tests/verse-selection.test.mjs` case for case.
struct VerseSelection: Sendable, Equatable, Hashable {
    /// Inclusive, 1-based. `start <= end` always holds.
    let start: Int
    let end: Int

    init(start: Int, end: Int) {
        self.start = min(start, end)
        self.end = max(start, end)
    }

    /// Upper bound on a range. The verse-insight route caps the text it
    /// explains at 2,500 characters and a KJV verse averages about 120, so ten
    /// verses stay safely under it and still cover any paragraph a reader would
    /// highlight or share as one unit.
    static let maxVerses = 10

    /// The sheet's one-line answer to a tap the cap refused.
    static let capMessage = "Up to \(maxVerses) verses at a time."

    var count: Int { end - start + 1 }

    var verses: [Int] { Array(start...end) }

    func includes(_ verse: Int) -> Bool { verse >= start && verse <= end }

    /// The reader's tap rule.
    ///
    /// - No selection: the tapped verse becomes the selection.
    /// - Tapping the only selected verse clears the selection (closes the sheet).
    /// - Tapping a verse inside a wider range re-anchors on that verse alone.
    /// - Tapping outside the range grows it to cover the verse; a range that
    ///   would exceed `maxVerses` is left unchanged.
    static func toggle(_ current: VerseSelection?, verse: Int) -> VerseSelection? {
        guard let current else { return VerseSelection(start: verse, end: verse) }
        if current.includes(verse) {
            return current.count == 1 ? nil : VerseSelection(start: verse, end: verse)
        }
        let next = VerseSelection(start: min(current.start, verse), end: max(current.end, verse))
        return next.count > maxVerses ? current : next
    }

    /// "Genesis 1:1" for one verse, "Genesis 1:1-3" for a range.
    func reference(bookName: String, chapter: Int) -> String {
        let base = "\(bookName) \(chapter):\(start)"
        return start == end ? base : "\(base)-\(end)"
    }

    /// The selected text with no markup. A single verse is its bare text; a
    /// range numbers each verse so the passage reads correctly once copied or
    /// explained. `plainTexts` is indexed from verse 1 at position 0.
    func text(in plainTexts: [String]) -> String {
        func verseText(_ verse: Int) -> String {
            verse >= 1 && verse <= plainTexts.count ? plainTexts[verse - 1] : ""
        }
        if start == end { return verseText(start) }
        return verses
            .map { "\($0) \(verseText($0))".trimmingCharacters(in: .whitespacesAndNewlines) }
            .joined(separator: " ")
    }

    /// Clipboard and share payload, the same shape the sheet has always used.
    static func shareText(reference: String, text: String, translation: String) -> String {
        "\(reference) \u{2014} \"\(text)\" (\(translation))"
    }

    /// The highlight colour the whole selection shares, or nil when the verses
    /// differ or any of them is unmarked. The strip rings a colour only when
    /// tapping it again would remove exactly what is shown.
    func sharedColor(in highlights: [Int: String]) -> String? {
        var shared: String?
        for verse in verses {
            guard let color = highlights[verse] else { return nil }
            if let current = shared {
                guard current.lowercased() == color.lowercased() else { return nil }
            } else {
                shared = color
            }
        }
        return shared
    }
}
