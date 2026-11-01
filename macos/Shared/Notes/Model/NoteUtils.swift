import Foundation

/// Derivations shared by the notes list and editor — a port of
/// `mobile/src/features/notes/utils.ts`.
///
/// Derives text from leaf blocks, matching web and Android without treating
/// list, quote or task wrappers as additional blank lines. Entity decoding is
/// applied to text tokens, preserving escaped markup as visible text.
enum NoteUtils {

    /// One separator per leaf block. Wrappers do not create empty lines;
    /// explicit BRs, empty paragraphs/items and preformatted text remain.
    static func htmlToPlainText(_ html: String) -> String {
        func decode(_ text: String) -> String {
            text.replacing("&nbsp;", with: " ", caseInsensitive: true)
                .replacing("&lt;", with: "<", caseInsensitive: true)
                .replacing("&gt;", with: ">", caseInsensitive: true)
                .replacing("&quot;", with: "\"", caseInsensitive: true)
                .replacing("&#3[49];", with: "'")
                .replacing("&amp;", with: "&", caseInsensitive: true)
        }
        func matches(_ pattern: String, _ text: String) -> [NSTextCheckingResult] {
            let regex = try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
            return regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
        }
        // Raw script/style contents are not HTML token streams (e.g. a < b).
        let source = html.replacing("<(script|style)[\\s\\S]*?</\\1>", with: "", caseInsensitive: true)
        if matches("<[a-z/!][^>]*>", source).isEmpty {
            return decode(source).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        var blocks: [String] = []
        var current: String?
        var preDepth = 0
        var skipDepth = 0
        var items: [Bool] = []
        var wrappers: [Bool] = []
        func finish() {
            guard let text = current else { return }
            blocks.append(preDepth > 0 ? text : text.replacing("^ +| +$", with: ""))
            current = nil
            if !items.isEmpty { items[items.count - 1] = true }
            for index in wrappers.indices { wrappers[index] = true }
        }
        let voidTags: Set<String> = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]
        for match in matches(#"<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|<"#, source) {
            let token = (source as NSString).substring(with: match.range)
            if token.hasPrefix("<!--") { continue }
            guard let tag = matches(#"^<\s*(/?)\s*([a-z][\w:-]*)\b"#, token).first else {
                if skipDepth > 0 || token.hasPrefix("<!") { continue }
                let text = preDepth > 0 ? decode(token) : decode(token).replacing("[ \\t\\r\\n]+", with: " ")
                if text == " " && (current == nil || current == "") { continue }
                current = (current ?? "") + text
                continue
            }
            let closing = (token as NSString).substring(with: tag.range(at: 1)) == "/"
            let name = (token as NSString).substring(with: tag.range(at: 2)).lowercased()
            let selfClosing = !matches(#"/\s*>$"#, token).isEmpty || voidTags.contains(name)
            if skipDepth > 0 {
                skipDepth += closing ? -1 : selfClosing ? 0 : 1
                continue
            }
            if !closing && ["script", "style", "noscript", "label"].contains(name) {
                if !selfClosing { skipDepth = 1 }
                continue
            }
            if name == "br" {
                if !closing { current = (current ?? "") + "\n" }
                continue
            }
            if name == "hr" {
                if !closing { finish(); current = ""; finish() }
                continue
            }
            if name == "div" || name == "tr" {
                finish()
                if !closing { wrappers.append(false) }
                else {
                    if wrappers.last == false { current = ""; finish() }
                    if !wrappers.isEmpty { wrappers.removeLast() }
                }
                continue
            }
            if !matches("^(p|h[1-6])$", name).isEmpty {
                finish()
                if !closing { current = "" }
                continue
            }
            if ["blockquote", "ul", "ol", "li", "pre"].contains(name) {
                finish()
                if name == "li" {
                    if !closing { items.append(false) }
                    else {
                        if items.last == false { current = ""; finish() }
                        if !items.isEmpty { items.removeLast() }
                    }
                }
                if name == "pre" { preDepth = max(0, preDepth + (closing ? -1 : 1)) }
            }
        }
        finish()
        return blocks.joined(separator: "\n")
    }

    static func countWords(_ text: String) -> Int {
        text.split(whereSeparator: \.isWhitespace).count
    }

    /// True for the empty documents the rich editors produce
    /// (`""`, `<p></p>`, `<p><br></p>`).
    static func isBlankHTML(_ html: String) -> Bool {
        htmlToPlainText(html).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
