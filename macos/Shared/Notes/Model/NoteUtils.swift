import Foundation

/// Derivations shared by the notes list and editor — a port of
/// `mobile/src/features/notes/utils.ts`.
///
/// Like the Android client this has no DOM to lean on, so `plainText` and
/// `wordCount` are derived from the editor HTML by the same regex chain. The
/// order of those substitutions is load-bearing (entities are decoded *after*
/// tags are stripped, so a literal `&lt;p&gt;` in the text survives), and the
/// Vitest suite that pins it is ported alongside in `NoteUtilsTests`.
enum NoteUtils {

    /// Closing tags that end a visual block and therefore become a newline.
    private static let blockClose = "</(p|div|h[1-6]|li|blockquote|tr|pre)>"

    static func htmlToPlainText(_ html: String) -> String {
        guard !html.isEmpty else { return "" }
        var text = html
        text = text.replacing("<(script|style)[\\s\\S]*?</\\1>", with: "", caseInsensitive: true)
        text = text.replacing("<br\\s*/?>", with: "\n", caseInsensitive: true)
        text = text.replacing(blockClose, with: "\n", caseInsensitive: true)
        text = text.replacing("<[^>]*>", with: "")
        text = text.replacing("&nbsp;", with: " ", caseInsensitive: true)
        text = text.replacing("&lt;", with: "<", caseInsensitive: true)
        text = text.replacing("&gt;", with: ">", caseInsensitive: true)
        text = text.replacing("&quot;", with: "\"", caseInsensitive: true)
        // Deliberately matches both `&#34;` and `&#39;`, exactly as the TS
        // original's `/&#3[49];/g` does. It is a quirk, not a Swift slip: the
        // three clients must derive byte-identical plainText or a note saved on
        // one shows a different search preview on another.
        text = text.replacing("&#3[49];", with: "'")
        text = text.replacing("&amp;", with: "&", caseInsensitive: true)
        text = text.replacing("[ \\t]+", with: " ")
        text = text.replacing(" ?\n ?", with: "\n")
        text = text.replacing("\n{3,}", with: "\n\n")
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func countWords(_ text: String) -> Int {
        text.split(whereSeparator: \.isWhitespace).count
    }

    /// True for the empty documents the rich editors produce
    /// (`""`, `<p></p>`, `<p><br></p>`).
    static func isBlankHTML(_ html: String) -> Bool {
        htmlToPlainText(html).isEmpty
    }

    /// The web stores Tiptap JSON in `content` and HTML in `htmlContent`, but
    /// older notes can hold HTML in both. Prefer `htmlContent`; fall back to
    /// `content` only when it is not JSON.
    static func initialHTML(for note: Note) -> String {
        initialHTML(content: note.content, htmlContent: note.htmlContent)
    }

    static func initialHTML(content: String, htmlContent: String) -> String {
        if !htmlContent.isEmpty, !isBlankHTML(htmlContent) { return htmlContent }
        let raw = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return "" }
        if raw.hasPrefix("{") || raw.hasPrefix("[") { return "" }
        return raw
    }

    // MARK: - Relative time

    private static let minute: TimeInterval = 60
    private static let hour: TimeInterval = 60 * minute
    private static let day: TimeInterval = 24 * hour

    /// `now` is injectable so the ported time tests don't depend on the clock.
    static func relativeTime(_ iso: String, now: Date = Date()) -> String {
        guard let then = parseISO(iso) else { return "" }
        let diff = now.timeIntervalSince(then)
        if diff < minute { return "Just now" }
        if diff < hour { return "\(Int(diff / minute))m ago" }
        if diff < day { return "\(Int(diff / hour))h ago" }
        if diff < 7 * day { return "\(Int(diff / day))d ago" }

        let calendar = Calendar(identifier: .gregorian)
        let sameYear = calendar.component(.year, from: then) == calendar.component(.year, from: now)
        return (sameYear ? shortDateFormatter : shortDateWithYearFormatter).string(from: then)
    }

    /// Prisma serialises `DateTime` with fractional seconds; older rows and
    /// hand-written fixtures may not have them, so try both.
    static func parseISO(_ iso: String) -> Date? {
        if let date = fractionalISOFormatter.date(from: iso) { return date }
        return plainISOFormatter.date(from: iso)
    }

    // `ISO8601DateFormatter` is documented as safe to use from multiple threads
    // once configured, but it is not marked `Sendable`, so the shared instances
    // are opted out explicitly. Both are configured here and never mutated
    // again — building one per timestamp would be the alternative, and the
    // notes list formats one for every row on every keystroke of its search
    // field.
    nonisolated(unsafe) private static let fractionalISOFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) private static let plainISOFormatter = ISO8601DateFormatter()

    private static let shortDateFormatter = makeDateFormatter("MMM d")
    private static let shortDateWithYearFormatter = makeDateFormatter("MMM d, yyyy")

    /// Matches JS `toLocaleDateString("en-US", …)`, which the other clients use.
    private static func makeDateFormatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = format
        return formatter
    }

    // MARK: - Tags

    static func tags(for note: Note, in tags: [Tag]) -> [Tag] {
        tags.filter { note.tagIds.contains($0.id) }
    }
}

private extension String {
    /// ICU-backed replace, so the ported patterns behave the way the TS regexes
    /// they came from do (`[\s\S]`, backreferences, lazy quantifiers).
    func replacing(_ pattern: String, with template: String, caseInsensitive: Bool = false) -> String {
        guard
            let regex = try? NSRegularExpression(
                pattern: pattern,
                options: caseInsensitive ? [.caseInsensitive] : []
            )
        else { return self }
        return regex.stringByReplacingMatches(
            in: self,
            range: NSRange(startIndex..., in: self),
            withTemplate: NSRegularExpression.escapedTemplate(for: template)
        )
    }
}
