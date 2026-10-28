import Foundation

/// Tappable Bible references in chat text ("John 3:16" opens it). Port of
/// `mobile/src/features/chat/verseLinks.ts`; `VerseLinksTests` carries its
/// cases.
///
/// Detection is `VersePassages.citationMatches`, the scan that already orders
/// an answer's passages, so every candidate is validated through
/// `VersePassages.resolveCitation` and a plausible-looking but unparseable
/// string ("John 99:16", "version 3:16") stays plain text and can never
/// navigate into the wrong book. Spanish and German book names come with it.
///
/// A reference becomes an ordinary `.link` run with the `sureword-verse:`
/// scheme, which the chat bubbles intercept through `openURL`: in an answer, a
/// reference this turn retrieved opens the "Scripture in this answer" sheet on
/// its passage; anything else (and every reference in a question) opens the
/// reader at that verse.
enum VerseLinks {
    /// Never leaves the app: the bubbles' `OpenURLAction` claims it.
    static let scheme = "sureword-verse"

    enum Segment: Equatable, Sendable {
        case text(String)
        case reference(String)
    }

    /// Where a tapped reference goes.
    enum Destination: Equatable, Sendable {
        /// A passage the answer retrieved, by its key in `GroupedVerses`.
        case passage(key: String)
        /// The reader, at a canonical English reference ("John 3:16").
        case reader(reference: String)
    }

    // MARK: Detection

    /// Split plain text into prose and reference segments.
    static func segments(in text: String) -> [Segment] {
        let nsText = text as NSString
        var segments: [Segment] = []
        var cursor = 0
        for match in matches(in: text) {
            if match.range.location > cursor {
                segments.append(.text(nsText.substring(with: NSRange(location: cursor, length: match.range.location - cursor))))
            }
            segments.append(.reference(match.value))
            cursor = match.range.location + match.range.length
        }
        if cursor < nsText.length {
            segments.append(.text(nsText.substring(from: cursor)))
        }
        return segments
    }

    /// The validated references in `text`, memoized per string. A streamed
    /// answer re-renders every paragraph on every chunk while only the last
    /// one changes, so the settled paragraphs are cache hits and the ~1 kB
    /// alternation runs once per new piece of text (Android hoists the regex
    /// for the same reason, B7).
    static func matches(in text: String) -> [(range: NSRange, value: String)] {
        guard !text.isEmpty else { return [] }
        let key = text as NSString
        if let cached = cache.object(forKey: key) { return cached.matches }
        let found = VersePassages.citationMatches(in: text)
        cache.setObject(CachedMatches(found), forKey: key)
        return found
    }

    private final class CachedMatches {
        let matches: [(range: NSRange, value: String)]
        init(_ matches: [(range: NSRange, value: String)]) { self.matches = matches }
    }

    /// Bounded: an evicted string is simply scanned again.
    nonisolated(unsafe) private static let cache: NSCache<NSString, CachedMatches> = {
        let cache = NSCache<NSString, CachedMatches>()
        cache.countLimit = 512
        return cache
    }()

    // MARK: Links

    static func url(for reference: String) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.path = reference
        return components.url
    }

    /// The raw reference a `sureword-verse:` link carries; nil for any other URL.
    static func reference(from url: URL) -> String? {
        guard url.scheme == scheme,
              let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.path,
              !path.isEmpty
        else { return nil }
        return path
    }

    /// Marks every reference in `attributed` as a link. Code spans and text
    /// that is already a link (a markdown `[John 3:16](https://...)` label) are
    /// left alone, as Android's markdown plugin leaves them.
    static func linkingReferences(in attributed: AttributedString) -> AttributedString {
        let text = String(attributed.characters)
        let found = matches(in: text)
        guard !found.isEmpty else { return attributed }
        var linked = attributed
        for match in found {
            guard let range = Range(match.range, in: linked), let url = url(for: match.value) else { continue }
            let blocked = linked[range].runs.contains { run in
                run.link != nil || run.inlinePresentationIntent?.contains(.code) == true
            }
            if !blocked { linked[range].link = url }
        }
        return linked
    }

    /// A question's plain text with its references linked (no markdown: a
    /// question is shown as typed).
    static func linkedPlainText(_ text: String) -> AttributedString {
        linkingReferences(in: AttributedString(text))
    }

    // MARK: Routing

    /// "Juan 3:16", "Ps 23:1-6 KJV" -> "John 3:16", "Psalms 23:1": the form the
    /// reader's pending-reference hop resolves. Ranges open at their first
    /// verse, as Android's `openReferenceInReader` does. Nil when unresolvable.
    static func readerReference(for raw: String) -> String? {
        guard let target = VersePassages.resolveCitation(raw),
              let name = Bible.book(order: target.order)?.name
        else { return nil }
        guard let verse = target.verse else { return "\(name) \(target.chapter)" }
        return "\(name) \(target.chapter):\(verse)"
    }

    /// Android `MessageBubble.onVerseReference`: the retrieved passage holding
    /// the reference when there is one (`grouped` is nil for a question or a
    /// streaming answer), otherwise the reader. Nil for an unresolvable tap,
    /// which then does nothing.
    static func destination(for raw: String, grouped: GroupedVerses?) -> Destination? {
        if let passage = grouped?.passage(for: raw) { return .passage(key: passage.key) }
        return readerReference(for: raw).map(Destination.reader(reference:))
    }
}
