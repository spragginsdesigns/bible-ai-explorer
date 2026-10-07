import Foundation

/// One verse as the reader draws it: the editorial headings above it, the
/// formatted segments, and whether the edition omits its text.
struct ReaderVerse: Sendable, Equatable {
    let number: Int
    /// Publisher-authored headings. Rendered above the verse, never copied.
    let headings: [String]
    let segments: [ReaderSegment]
    let omitted: Bool

    /// What Copy, Share, Note, Ask and the explanation see - Android's
    /// `plainTexts` entry for this verse.
    var plainText: String { segments.map(\.text).joined() }
}

/// Source-authored reader formatting: the KJV words of Jesus (eBible sidecar,
/// `Data/kjv-red-letters.json`), BSB's own speech spans and italics, and the
/// BSB editorial headings shown on KJV and BSB (`Data/section-headings.json`).
///
/// Port of `mobile/src/features/bible/redLetters.ts`. Nothing here is
/// inferred: a speech span applies only when the stored text matches the
/// verse exactly, so a stale offset can never colour the wrong words, and KJV
/// offsets are never reused for NKJV.
actor ReaderAnnotations {
    static let shared = ReaderAnnotations()

    private struct SpeechAnnotation: Decodable {
        let text: String
        let ranges: [[Int]]
    }

    private var speech: [String: SpeechAnnotation]?
    private var headings: [String: [String]]?

    /// The chapter's verses, formatted. `markups` is what
    /// `BibleTranslations.chapter` returned for the same reference.
    func chapter(
        _ translation: TranslationID,
        order: Int,
        chapter: Int,
        markups: [String]
    ) async -> [ReaderVerse] {
        let bsb = translation == .bsb
            ? (try? await BSBLibrary.shared.chapter(order: order, chapter: chapter))
            : nil
        return markups.enumerated().map { index, markup in
            let number = index + 1
            let formatted = bsb.flatMap { number <= $0.count ? $0[number - 1] : nil }
            return ReaderVerse(
                number: number,
                headings: sectionHeadings(translation, order: order, chapter: chapter, verse: number),
                segments: segments(
                    markup,
                    translation: translation,
                    order: order,
                    chapter: chapter,
                    verse: number,
                    bsb: formatted
                ),
                omitted: formatted?.omitted ?? false
            )
        }
    }

    /// `readerSectionHeadings`: none for NKJV, the shared BSB set otherwise.
    func sectionHeadings(_ translation: TranslationID, order: Int, chapter: Int, verse: Int) -> [String] {
        guard translation != .nkjv else { return [] }
        return loadHeadings()["\(order):\(chapter):\(verse)"] ?? []
    }

    /// `readerVerseSegments`.
    func segments(
        _ markup: String,
        translation: TranslationID,
        order: Int,
        chapter: Int,
        verse: Int,
        bsb: BSBVerse? = nil
    ) -> [ReaderSegment] {
        let parsed = VerseMarkup.segments(markup).map {
            ReaderSegment(text: $0.text, italic: $0.italic)
        }
        switch translation {
        case .bsb:
            guard let bsb, bsb.text == markup else { return parsed }
            return bsb.segments
        case .nkjv:
            return parsed
        case .kjv:
            guard let entry = loadSpeech()["\(order):\(chapter):\(verse)"] else { return parsed }
            return Self.split(parsed, ranges: entry.ranges, expected: entry.text)
        }
    }

    /// Split parsed segments at the speech range boundaries. Offsets are
    /// UTF-16 code units, as they are in the JavaScript that wrote them.
    static func split(_ segments: [ReaderSegment], ranges: [[Int]], expected: String) -> [ReaderSegment] {
        guard segments.map(\.text).joined() == expected else { return segments }
        let spans = ranges.compactMap { range -> (Int, Int)? in
            range.count == 2 ? (range[0], range[1]) : nil
        }
        let cuts = Set(spans.flatMap { [$0.0, $0.1] })
        var result: [ReaderSegment] = []
        var offset = 0
        for segment in segments {
            let units = Array(segment.text.utf16)
            let end = offset + units.count
            let boundaries = Set([offset, end] + cuts.filter { $0 > offset && $0 < end }).sorted()
            for index in 0..<max(0, boundaries.count - 1) {
                let start = boundaries[index]
                let stop = boundaries[index + 1]
                let piece = String(decoding: units[(start - offset)..<(stop - offset)], as: UTF16.self)
                result.append(
                    ReaderSegment(
                        text: piece,
                        italic: segment.italic,
                        jesusSpeech: spans.contains { start >= $0.0 && start < $0.1 }
                    )
                )
            }
            offset = end
        }
        return result
    }

    // MARK: - Loading

    private func loadSpeech() -> [String: SpeechAnnotation] {
        if let speech { return speech }
        let loaded = Self.decode([String: SpeechAnnotation].self, json: "kjv-red-letters") ?? [:]
        speech = loaded
        return loaded
    }

    private func loadHeadings() -> [String: [String]] {
        if let headings { return headings }
        let loaded = Self.decode([String: [String]].self, json: "section-headings") ?? [:]
        headings = loaded
        return loaded
    }

    private static func decode<Value: Decodable>(_ type: Value.Type, json name: String) -> Value? {
        guard let url = BibleBundle.url(json: name, subdirectory: "Data"),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
