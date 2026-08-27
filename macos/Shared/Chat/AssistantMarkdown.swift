import Foundation

/// Normalization for assistant-authored markdown before it reaches a renderer.
///
/// A line-for-line port of `src/utils/assistantMarkdown.ts` (mirrored on
/// Android as `mobile/src/lib/assistantMarkdown.ts`), so macOS and iOS repair
/// the same model-output quirks the web and Android clients do - exactly one
/// Scripture card per quoted verse, fences/lists/HTML/CRLF repaired, and
/// mid-stream fragments closed rather than rendered as literal `**`.
///
/// Behaviour is pinned to the SAME shared corpus the vitest suites loop over,
/// `tests/fixtures/assistant-markdown-corpus.json`, by
/// `SureWordTests/AssistantMarkdownTests.swift`. This is not a re-derived
/// spec: if a rule changes on the TS side, the corpus changes with it and this
/// port fails until it agrees again.
///
/// Two representation notes, both load-bearing:
///
/// - **Everything below works on `[Unicode.Scalar]`, never on `Character`.**
///   The TS indexes strings by UTF-16 unit, so every one of its rules asks
///   "is the code unit at position i one of `*` `` ` `` `~` `>` `#` `-` `|` a
///   digit, a space, a tab?". A Swift `Character` is a grapheme CLUSTER, and a
///   cluster is a different question: `"*"` followed by U+FE0F, or `">"`
///   followed by a combining acute, is ONE `Character` that equals neither
///   `"*"` nor `">"`. Every marker test - `markerRuns`, `countEmphasisRuns`,
///   `pendingBacktickRun`, `indentWidth`, `contentStart`, the fence and list
///   scans - would then miss the marker and diverge from the TS, which is not
///   hypothetical: `"Step **\u{FE0F}\u{20E3} one"` left a literal `**` on
///   screen mid-stream and `"Text\n>\u{0301} quoted"` never became a
///   blockquote card. Scalars answer the TS's question exactly: every rule
///   here compares against an ASCII literal, and neither a surrogate half nor
///   an astral scalar is ever ASCII, so scalar indexing and UTF-16 indexing
///   agree on every comparison the port makes. Scalars are also several times
///   cheaper - grapheme breaking is not free, and a streamed answer is
///   re-normalized on every token.
/// - **Lines are split at the scalar level too.** Swift's `Character` folds
///   `"\r\n"` into ONE grapheme, so `components(separatedBy: "\n")` does not
///   split a CRLF document at all. `splitLines` walks `unicodeScalars`
///   instead, and `normalize` splits ONCE and threads the same line array
///   through every stage rather than re-splitting per stage.
enum AssistantMarkdown {

    /// One line of the document: its scalars, with no line terminator.
    private typealias Line = [Unicode.Scalar]

    // MARK: - Text parts

    /// The AI SDK splits an assistant turn into separate text parts around tool
    /// calls. The next part usually opens a new block ("- …", "## …", "> …"),
    /// so parts must be separated by a blank line or markdown constructs never
    /// parse. Empty parts are dropped: providers routinely emit a zero-length
    /// text item before the real answer, and joining it would fabricate a
    /// leading blank line.
    static func joinTextParts(_ parts: [String]) -> String {
        parts.filter { !$0.unicodeScalars.allSatisfy(isJSWhitespace) }.joined(separator: "\n\n")
    }

    // MARK: - Pipeline

    /// Full pipeline applied right before rendering an assistant message.
    ///
    /// Every stage is line-based, and only `repairMarkdownBlocks` normalizes
    /// endings - so a lone CR (which JS's own `/m` anchors DO treat as a line
    /// break) made the two earlier stages see the whole document as one line.
    /// Doing it once here fixes that; `repairMarkdownBlocks` keeps its own call
    /// because it is exercised directly by the corpus vectors.
    ///
    /// The split happens once and the line array is threaded through every
    /// stage: joining and re-splitting between stages was pure overhead, and
    /// this is called again on every streamed token.
    static func normalize(_ text: String, streaming: Bool) -> String {
        var lines = splitLines(normalizeLineEndings(text))
        lines = stripFollowUpLines(lines, streaming: streaming)
        lines = normalizeInlineHtmlLines(lines)
        lines = repairMarkdownBlockLines(lines)
        if streaming { lines = closeOpenInlineLines(lines) }
        // Later stages can reintroduce trailing whitespace stripFollowUpMarkers
        // already removed - an exotic bullet becoming "- " with nothing after
        // it, a trimmed stream-head marker leaving a blank last line. Trimming
        // again is what makes the pipeline a fixed point.
        return joinLines(trimEndLines(lines))
    }

    // MARK: - [FOLLOWUP] markers

    /// Remove `[FOLLOWUP]` marker lines. Complete lines are always removed
    /// (same per-line semantics as the server's `stripFollowUps`); while
    /// streaming, a partial trailing marker is removed too so it never flashes
    /// as literal text. Markers inside a code block, fenced or indented, are
    /// left alone - there they are sample text.
    static func stripFollowUpMarkers(_ text: String, streaming: Bool) -> String {
        joinLines(stripFollowUpLines(splitLines(text), streaming: streaming))
    }

    private static func stripFollowUpLines(_ lines: [Line], streaming: Bool) -> [Line] {
        let fences = scanFences(lines)
        let code = scanIndentedCode(lines, fences)
        var kept: [Line] = []
        kept.reserveCapacity(lines.count)
        var index = 0
        while index < lines.count {
            let line = lines[index]
            if !fences.inside[index], !code[index], isFollowUpLine(line) {
                // Removing the marker line must not leave a doubled blank line.
                let followsBlank = kept.isEmpty || isBlankLine(kept[kept.count - 1])
                index += 1
                while followsBlank,
                      index < lines.count,
                      !fences.inside[index],
                      !code[index],
                      isBlankLine(lines[index]) {
                    index += 1
                }
                continue
            }
            kept.append(line)
            index += 1
        }
        if streaming { kept = stripPartialFollowUp(kept) }
        return trimEndLines(kept)
    }

    /// `/^[ \t]*\[FOLLOWUP\]/` - anchored to the start of a line, because the
    /// server only ever emits markers there and an unanchored match ate
    /// mid-sentence prose that merely mentioned one.
    private static func isFollowUpLine(_ line: Line) -> Bool {
        var index = contentStart(line)
        for expected in followUpMarker {
            guard index < line.count, line[index] == expected else { return false }
            index += 1
        }
        return true
    }

    private static let followUpMarker = Array("[FOLLOWUP]".unicodeScalars)
    private static let followUpWord = Array("FOLLOWUP".unicodeScalars)

    /// `/(?:^|\r?\n)[ \t]*\[(?:F|FO|…|FOLLOWUP)?$/` applied once: a trailing,
    /// still-typed marker at the end of the buffer, and only when it starts its
    /// own line - otherwise a markdown link being typed ("see [") flickers away
    /// mid-stream.
    ///
    /// The matched tail can contain no line break, so the only start position
    /// that can reach end-of-input is the beginning of the LAST line (or
    /// position 0, which is the same thing when there is only one line). JS
    /// scans start positions left to right, and every earlier one fails on the
    /// newline it would have to consume.
    private static func stripPartialFollowUp(_ lines: [Line]) -> [Line] {
        guard let last = lines.last, matchesPartialFollowUp(last) else { return lines }
        if lines.count == 1 { return [[]] }
        return Array(lines.dropLast())
    }

    private static func matchesPartialFollowUp(_ line: Line) -> Bool {
        var index = 0
        while index < line.count, line[index] == " " || line[index] == "\t" { index += 1 }
        guard index < line.count, line[index] == "[" else { return false }
        index += 1
        let remaining = line.count - index
        guard remaining <= followUpWord.count else { return false }
        for offset in 0..<remaining where line[index + offset] != followUpWord[offset] {
            return false
        }
        return true
    }

    // MARK: - Inline HTML

    /// Turn model-emitted `<br>` into a markdown hard break and drop the
    /// remaining HTML tags - neither renderer interprets raw HTML, so the tags
    /// are removed here and their text content kept. Fenced code and inline
    /// code spans are untouched.
    ///
    /// A `<br>` with nothing but whitespace after it is DELETED rather than
    /// turned into "  \n": that trailing newline opened a blank line, and a
    /// blank line closes whatever container the line sat in - which is how a
    /// quoted verse whose lines each end in `<br>` reached the renderer as
    /// three separate quote cards. A mid-line `<br>` becomes a hard break
    /// followed by the line's own container prefix.
    ///
    /// A `<br>` inside a GFM TABLE ROW becomes a single space instead: a row is
    /// a single line by definition, so any hard break invents a phantom row
    /// with the wrong column count.
    static func normalizeInlineHtml(_ text: String) -> String {
        joinLines(normalizeInlineHtmlLines(splitLines(text)))
    }

    private static func normalizeInlineHtmlLines(_ lines: [Line]) -> [Line] {
        // Every pattern below needs a "<". Checking per line rather than per
        // document keeps the three NSRegularExpression passes off the ~99% of
        // lines that cannot possibly match, and the reassembly of a line with
        // no "<" is the identity anyway.
        guard lines.contains(where: { $0.contains("<") }) else { return lines }
        let fences = scanFences(lines)
        let code = scanIndentedCode(lines, fences)
        var out: [Line] = []
        out.reserveCapacity(lines.count)

        for index in 0..<lines.count {
            let line = lines[index]
            if fences.inside[index] || fences.delimiter[index] || code[index]
                || !line.contains("<") {
                out.append(line)
                continue
            }
            let isTableRow = firstNonBlank(line) == "|"
            var pieces: [Line] = [[]]
            let segments = splitInlineCode(line)
            for segment in segments.indices {
                if segment % 2 == 1 {
                    pieces[pieces.count - 1].append(contentsOf: segments[segment])
                    continue
                }
                let parts = splitOnHtmlBreaks(scalarString(segments[segment]))
                for part in parts.indices {
                    if part > 0 {
                        if isTableRow {
                            // One space, not two: a run of breaks, or a break
                            // already flanked by a space, must not grow the
                            // cell's whitespace on every pass - the pipeline
                            // has to stay a fixed point.
                            let at = pieces.count - 1
                            let before = pieces[at].last
                            let after = parts[part].unicodeScalars.first
                            let spaced = before == " " || before == "\t"
                                || after == " " || after == "\t"
                            if !spaced { pieces[at].append(" ") }
                        } else {
                            pieces.append([])
                        }
                    }
                    pieces[pieces.count - 1]
                        .append(contentsOf: stripHtmlFromSegment(parts[part]).unicodeScalars)
                }
            }

            // The first piece carries the line's own prefix and is always kept;
            // a later piece with no text of its own would render as a blank
            // line and close the container, so consecutive and trailing breaks
            // are dropped.
            var kept: [Line] = [pieces[0]]
            for piece in 1..<pieces.count where !isBlankLine(pieces[piece]) {
                kept.append(pieces[piece])
            }
            if kept.count < pieces.count {
                kept[kept.count - 1] = trimTrailingSpacesAndTabs(kept[kept.count - 1])
            }
            if kept.count == 1 {
                out.append(kept[0])
                continue
            }

            // Only the first piece already carries the line's prefix; the rest
            // have to repeat it. A leading piece that is nothing but that
            // prefix is dropped so a line opening with <br> never starts with a
            // whitespace-only line.
            let prefix = continuationPrefix(line)
            var rendered: [Line] = []
            for piece in kept.indices {
                let body = piece == 0 ? kept[piece] : prefix + kept[piece]
                if rendered.isEmpty, isBlankLine(body) { continue }
                rendered.append(body)
            }
            var joined: Line = []
            for (offset, body) in rendered.enumerated() {
                if offset > 0 { joined.append(contentsOf: [" ", " ", "\n"] as Line) }
                joined.append(contentsOf: body)
            }
            out.append(joined)
        }

        return out
    }

    // MARK: - Block repair

    /// Give block constructs room to breathe and normalize exotic bullets.
    ///
    /// A list/heading/quote/fence line that directly follows plain prose gets a
    /// blank line inserted before it. Everything else is left exactly as
    /// written - the walk carries real container state (is a blockquote open?
    /// is a list open, and at what content column?) so a lazy continuation, a
    /// bare ">" spacer, a nested ">>", or a wrapped list item never gets a
    /// blank line jammed into the middle of the block it belongs to.
    static func repairMarkdownBlocks(_ text: String) -> String {
        // Mixed line endings defeat every line rule below, and the separators
        // this function injects would be bare "\n" amid "\r\n".
        joinLines(repairMarkdownBlockLines(splitLines(normalizeLineEndings(text))))
    }

    private static func repairMarkdownBlockLines(_ input: [Line]) -> [Line] {
        var lines = input
        let fences = scanFences(lines)
        let code = scanIndentedCode(lines, fences)

        for index in lines.indices {
            if fences.inside[index] || fences.delimiter[index] || code[index] { continue }
            lines[index] = normalizeExoticBullet(normalizeMarkerIndent(lines[index]))
        }

        var out: [Line] = []
        out.reserveCapacity(lines.count)
        var quoteOpen = false
        var listOpen = false
        var listColumn = 0
        var sawBlank = false
        // Every line up to here has already been offered to the dedent scan, so
        // a long run is walked once instead of once per line in it.
        var dedentScannedThrough = 0

        for index in 0..<lines.count {
            if fences.inside[index] || code[index] {
                out.append(lines[index])
                continue
            }
            let previous = out.last

            if isBlankLine(lines[index]) {
                // A blank line always closes a blockquote; a list may survive.
                quoteOpen = false
                sawBlank = true
                out.append(lines[index])
                continue
            }

            if sawBlank {
                if listOpen,
                   markerKind(lines[index]) != .list,
                   indentWidth(lines[index]) < listColumn {
                    listOpen = false
                    listColumn = 0
                }
                sawBlank = false
            }

            if !listOpen,
               index >= dedentScannedThrough,
               let previous,
               !isBlankLine(previous),
               // An indented previous line means this one is inside a code
               // block rather than under a paragraph, and dedenting would
               // break the block.
               indentWidth(previous) <= 3 {
                dedentScannedThrough = dedentOverIndentedMarkerRun(
                    &lines, fences: fences, code: code, start: index
                )
            }

            let width = indentWidth(lines[index])
            // Four columns of indent opens an indented code block, not a list,
            // so a marker that deep must never gain a blank line in front.
            let kind = width <= 3 ? markerKind(lines[index]) : nil

            if let kind, let previous, !isBlankLine(previous) {
                let previousKind = indentWidth(previous) <= 3 ? markerKind(previous) : nil
                let continuesQuote = quoteOpen && kind == .quote
                let continuesList = listOpen && (kind == .list || width >= listColumn)
                if previousKind == nil, !continuesQuote, !continuesList {
                    out.append([])
                }
            }

            if kind == .quote { quoteOpen = true }
            if kind == .list {
                let column = listContentColumn(lines[index])
                listColumn = listOpen ? min(listColumn, column) : column
                listOpen = true
            } else if kind != nil, width < listColumn {
                listOpen = false
                listColumn = 0
            }

            out.append(lines[index])
        }

        return out
    }

    /// A run of 4+-indented lines that are ALL markers, sitting directly under a
    /// paragraph, is a list the model over-indented - dedent it to column 0 so
    /// it parses. A run containing any non-marker line is a genuine code sample
    /// and is left alone, as is anything preceded by a blank line, anything
    /// nested inside an open list, and anything inside a fence.
    ///
    /// Returns the index the scan reached so the caller can skip the rest of
    /// the run and the whole walk stays linear rather than quadratic.
    private static func dedentOverIndentedMarkerRun(
        _ lines: inout [Line],
        fences: FenceScan,
        code: [Bool],
        start: Int
    ) -> Int {
        if fences.inside[start] || fences.delimiter[start] || code[start] { return start + 1 }
        if indentWidth(lines[start]) < 4 { return start + 1 }
        if markerKind(lines[start]) == nil { return start + 1 }
        var end = start
        var everyLineIsAMarker = true
        while end < lines.count {
            if fences.inside[end] || fences.delimiter[end] || code[end] { break }
            let line = lines[end]
            if isBlankLine(line) { break }
            if indentWidth(line) < 4 { break }
            if markerKind(line) == nil {
                everyLineIsAMarker = false
                break
            }
            end += 1
        }
        if !everyLineIsAMarker { return end + 1 }
        var minimum = Int.max
        for index in start..<end { minimum = min(minimum, indentWidth(lines[index])) }
        for index in start..<end {
            let width = indentWidth(lines[index]) - minimum
            lines[index] = Line(repeating: " ", count: width)
                + Line(lines[index].dropFirst(contentStart(lines[index])))
        }
        return end
    }

    /// `/^\t+(?=(?:[-*+]|\d{1,9}\.)[ \t]|#{1,6}[ \t]|>)/` → two spaces per tab.
    /// A tab indents four columns - exactly the indented-code trigger - so a
    /// tab-indented marker is re-indented rather than left to become code.
    private static func normalizeMarkerIndent(_ line: Line) -> Line {
        var tabs = 0
        while tabs < line.count, line[tabs] == "\t" { tabs += 1 }
        guard tabs > 0, markerFollows(line, at: tabs) else { return line }
        return Line(repeating: " ", count: tabs * 2) + Line(line.dropFirst(tabs))
    }

    private static func markerFollows(_ line: Line, at index: Int) -> Bool {
        guard index < line.count else { return false }
        let scalar = line[index]
        if scalar == ">" { return true }
        if scalar == "-" || scalar == "*" || scalar == "+" {
            return index + 1 < line.count && isSpaceOrTab(line[index + 1])
        }
        if scalar == "#" {
            var end = index
            while end < line.count, line[end] == "#" { end += 1 }
            let count = end - index
            return count <= 6 && end < line.count && isSpaceOrTab(line[end])
        }
        if isASCIIDigit(scalar) {
            var end = index
            while end < line.count, isASCIIDigit(line[end]) { end += 1 }
            let count = end - index
            guard count <= 9, end < line.count, line[end] == "." else { return false }
            return end + 1 < line.count && isSpaceOrTab(line[end + 1])
        }
        return false
    }

    /// Bullet glyphs models emit that neither remark nor markdown-it treat as
    /// list markers. En and em dashes are excluded on purpose: the model uses
    /// them to open verse attribution lines, and converting those would turn
    /// every citation into a list item. The trailing whitespace is optional
    /// because the system prompt itself few-shots the no-space form, and the
    /// leading group carries any blockquote prefix through so a bulleted list
    /// inside a quote is converted in place.
    private static let exoticBullets: Set<Unicode.Scalar> = [
        "\u{2022}", "\u{25CF}", "\u{25AA}", "\u{25E6}", "\u{25CB}", "\u{2023}",
    ]

    private static func normalizeExoticBullet(_ line: Line) -> Line {
        var index = 0
        while index < line.count, isSpaceOrTab(line[index]) { index += 1 }
        while index < line.count, line[index] == ">" {
            index += 1
            while index < line.count, isSpaceOrTab(line[index]) { index += 1 }
        }
        guard index < line.count, exoticBullets.contains(line[index]) else { return line }
        let carried = Line(line[0..<index])
        var rest = index + 1
        while rest < line.count, isSpaceOrTab(line[rest]) { rest += 1 }
        return carried + ["-", " "] + Line(line[rest...])
    }

    // MARK: - Stream-head inline repair

    /// Close inline constructs still open at the end of a partial stream so
    /// mid-stream renders don't show literal `**` or `` ` ``. Only call this
    /// while streaming - a finished message's unbalanced markers are the
    /// model's own text and should render as written.
    ///
    /// A marker sitting at the very END of the buffer is trimmed rather than
    /// closed: the model has only started typing it, and appending to a buffer
    /// that already ends in `**` yields four literal asterisks. Closers are
    /// appended to the last line of real prose, never to the end of the buffer:
    /// with a fence still open the buffer ends inside code.
    static func closeOpenInlineMarkdown(_ text: String) -> String {
        joinLines(closeOpenInlineLines(splitLines(text)))
    }

    private static func closeOpenInlineLines(_ input: [Line]) -> [Line] {
        var lines = input
        var fences = scanFences(lines)
        var code = scanIndentedCode(lines, fences)
        let last = lines.count - 1
        let tailIsCode = last >= 0
            && (fences.inside[last] || fences.delimiter[last] || code[last])

        if !tailIsCode, last >= 0, let trailing = trailingRun(lines[last]) {
            let body = scannableText(lines, fences: fences, code: code)
            let unmatched: Bool
            if trailing.scalar == "`" {
                unmatched = pendingBacktickRun(body) >= trailing.length
            } else {
                unmatched = trailing.length <= 2
                    && countEmphasisRuns(body, trailing.scalar) % 2 == 1
            }
            if unmatched {
                lines[last] = trimTrailingSpacesAndTabs(Line(lines[last][0..<trailing.index]))
                fences = scanFences(lines)
                code = scanIndentedCode(lines, fences)
            }
        }

        let body = scannableText(lines, fences: fences, code: code)
        var closers: Line = []
        let pending = pendingBacktickRun(body)
        if pending > 0 { closers += Line(repeating: "`", count: pending) }
        if countEmphasisRuns(body, "*") % 2 == 1 { closers += ["*", "*"] }
        if countEmphasisRuns(body, "~") % 2 == 1 { closers += ["~", "~"] }

        if !closers.isEmpty {
            // The last line that is prose rather than code, and that has
            // something to close. A non-empty body guarantees one exists.
            var target = -1
            for index in stride(from: lines.count - 1, through: 0, by: -1) {
                if fences.inside[index] || fences.delimiter[index] || code[index] { continue }
                if isBlankLine(lines[index]) { continue }
                target = index
                break
            }
            if target >= 0 { lines[target] += closers }
        }

        if let openScalar = fences.openScalar {
            // A fence opened inside a blockquote has to be closed inside it
            // too, or the synthesized delimiter lands outside the quote and
            // closes nothing.
            var synthesized: Line = []
            for _ in 0..<fences.openDepth { synthesized += [">", " "] }
            synthesized += Line(repeating: openScalar, count: fences.openLength)
            lines.append(synthesized)
        }

        return lines
    }

    /// `/(\*+|~+|`+)[ \t]*$/` - the first run, scanning left to right, whose
    /// tail to end of line is nothing but spaces and tabs.
    private static func trailingRun(
        _ line: Line
    ) -> (index: Int, scalar: Unicode.Scalar, length: Int)? {
        var index = 0
        while index < line.count {
            let scalar = line[index]
            guard scalar == "*" || scalar == "~" || scalar == "`" else {
                index += 1
                continue
            }
            var end = index
            while end < line.count, line[end] == scalar { end += 1 }
            var cursor = end
            while cursor < line.count, isSpaceOrTab(line[cursor]) { cursor += 1 }
            if cursor == line.count { return (index, scalar, end - index) }
            index = end
        }
        return nil
    }

    /// Count emphasis runs that could actually open or close a span. A run of
    /// three or more is a thematic break ("***") or combined emphasis, and a
    /// run flanked by alphanumerics on both sides is arithmetic ("2**3") -
    /// neither is markup, and counting them appended a stray "**".
    private static func countEmphasisRuns(_ text: Line, _ scalar: Unicode.Scalar) -> Int {
        var count = 0
        var index = 0
        while index < text.count {
            guard text[index] == scalar else {
                index += 1
                continue
            }
            var end = index
            while end < text.count, text[end] == scalar { end += 1 }
            if end - index == 2 {
                let before = index > 0 ? text[index - 1] : nil
                let after = end < text.count ? text[end] : nil
                if before == nil || after == nil
                    || !isASCIIAlphanumeric(before!) || !isASCIIAlphanumeric(after!) {
                    count += 1
                }
            }
            index = end
        }
        return count
    }

    /// Length of a code-span run left open, or 0 when backticks pair up. Code
    /// spans pair by run LENGTH, so "``a`b``" is balanced even though the total
    /// backtick count is odd.
    private static func pendingBacktickRun(_ text: Line) -> Int {
        var pending = 0
        var index = 0
        while index < text.count {
            guard text[index] == "`" else {
                index += 1
                continue
            }
            var end = index
            while end < text.count, text[end] == "`" { end += 1 }
            let length = end - index
            if pending == 0 { pending = length } else if length == pending { pending = 0 }
            index = end
        }
        return pending
    }

    private static func scannableText(
        _ lines: [Line], fences: FenceScan, code: [Bool]
    ) -> Line {
        var kept: Line = []
        var first = true
        for index in 0..<lines.count {
            if fences.inside[index] || fences.delimiter[index] || code[index] { continue }
            if !first { kept.append("\n") }
            kept.append(contentsOf: lines[index])
            first = false
        }
        return kept
    }

    // MARK: - Shared line primitives

    /// Columns the leading whitespace occupies, tabs expanded to 4-column stops.
    private static func indentWidth(_ line: Line) -> Int {
        var width = 0
        for scalar in line {
            if scalar == " " { width += 1 } else if scalar == "\t" {
                width += 4 - (width % 4)
            } else { break }
        }
        return width
    }

    /// Index of the first non-whitespace scalar on the line.
    private static func contentStart(_ line: Line) -> Int {
        var index = 0
        while index < line.count, isSpaceOrTab(line[index]) { index += 1 }
        return index
    }

    private struct ContainerPrefix {
        /// Number of ">" blockquote markers the line opens with.
        var depth: Int
        /// Columns of indent after the last marker, tabs expanded.
        var indent: Int
        /// Index just past the prefix.
        var end: Int
    }

    /// Split off a line's blockquote markers and the whitespace around them.
    /// Indent is measured from the LAST ">" because blockquote content is
    /// indented relative to its marker rather than to column zero.
    private static func containerPrefix(_ line: Line) -> ContainerPrefix {
        var end = 0
        var depth = 0
        var indent = 0
        while end < line.count {
            let scalar = line[end]
            if scalar == " " { indent += 1 } else if scalar == "\t" {
                indent += 4 - (indent % 4)
            } else if scalar == ">" {
                depth += 1
                indent = 0
            } else { break }
            end += 1
        }
        return ContainerPrefix(depth: depth, indent: indent, end: end)
    }

    /// CommonMark allows a fence 3 columns in RELATIVE to its container, so the
    /// absolute indent grows with every list level and a flat 3-column cap
    /// misreads a fence nested one level deep as prose. Rather than parse
    /// containers, allow up to 12 columns - three levels of nesting.
    private static let maxFenceIndent = 12

    private struct FenceCandidate {
        var depth: Int
        var scalar: Unicode.Scalar
        var length: Int
        var infoIsBlank: Bool
    }

    /// The fence this line would open or close, if any. A fence inside a
    /// blockquote ("> ```") or nested in a list item ("    ```") is a fence:
    /// not recognising those is what let every later stage rewrite real
    /// code-block contents.
    private static func fenceCandidate(_ line: Line) -> FenceCandidate? {
        let prefix = containerPrefix(line)
        if prefix.indent > maxFenceIndent { return nil }
        let start = prefix.end
        guard start < line.count else { return nil }
        let scalar = line[start]
        guard scalar == "`" || scalar == "~" else { return nil }
        var end = start
        while end < line.count, line[end] == scalar { end += 1 }
        guard end - start >= 3 else { return nil }
        return FenceCandidate(
            depth: prefix.depth,
            scalar: scalar,
            length: end - start,
            infoIsBlank: line[end...].allSatisfy(isJSWhitespace)
        )
    }

    private struct FenceScan {
        /// Line is fence content or the closing delimiter - never rewritten.
        var inside: [Bool]
        /// Line is an opening or closing fence delimiter.
        var delimiter: [Bool]
        /// Marker scalar of a fence still open at the end of the input.
        var openScalar: Unicode.Scalar?
        /// Run length of that still-open fence.
        var openLength: Int
        /// Blockquote depth the still-open fence was opened at.
        var openDepth: Int
    }

    /// Track fences by marker scalar AND run length, so a ``` line inside a
    /// ```` fence is content rather than a close, and a ~~~ fence is recognised
    /// at all.
    ///
    /// Blockquote depth is tracked too. A fence opened at "> ```" closes only
    /// on a delimiter at the same depth - and, because the blockquote itself
    /// ends at a blank line or at a line carrying fewer ">" markers, on the end
    /// of the quote. Without that second rule one unclosed quoted fence would
    /// mark the whole rest of the document as code.
    private static func scanFences(_ lines: [Line]) -> FenceScan {
        var inside: [Bool] = []
        var delimiter: [Bool] = []
        inside.reserveCapacity(lines.count)
        delimiter.reserveCapacity(lines.count)
        var openScalar: Unicode.Scalar?
        var openLength = 0
        var openDepth = 0

        for line in lines {
            if openScalar != nil, openDepth > 0,
               isBlankLine(line) || containerPrefix(line).depth < openDepth {
                openScalar = nil
                openLength = 0
                openDepth = 0
            }
            let wasOpen = openScalar != nil
            var isDelimiter = false
            if let candidate = fenceCandidate(line) {
                if !wasOpen {
                    openScalar = candidate.scalar
                    openLength = candidate.length
                    openDepth = candidate.depth
                    isDelimiter = true
                } else if candidate.depth == openDepth,
                          candidate.scalar == openScalar,
                          candidate.length >= openLength,
                          candidate.infoIsBlank {
                    openScalar = nil
                    openLength = 0
                    openDepth = 0
                    isDelimiter = true
                }
            }
            inside.append(wasOpen)
            delimiter.append(isDelimiter)
        }

        return FenceScan(
            inside: inside,
            delimiter: delimiter,
            openScalar: openScalar,
            openLength: openLength,
            openDepth: openDepth
        )
    }

    private enum MarkerKind {
        case list
        case heading
        case quote
        case fence
    }

    /// Which block construct, if any, this line opens. The blockquote arm
    /// accepts a bare ">" with no trailing space on purpose: ">", ">>" and
    /// ">text" are all blockquote lines, and treating them as prose is what
    /// split one quote into two cards.
    private static func markerKind(_ line: Line) -> MarkerKind? {
        let start = contentStart(line)
        guard start < line.count else { return nil }
        let scalar = line[start]
        if scalar == ">" { return .quote }
        if isListMarker(line, at: start) { return .list }
        if isHeadingMarker(line, at: start) { return .heading }
        if isFenceMarker(line, at: start) { return .fence }
        return nil
    }

    /// `/^(?:[-*+]|\d{1,9}\.)[ \t]/`
    private static func isListMarker(_ line: Line, at start: Int) -> Bool {
        let scalar = line[start]
        if scalar == "-" || scalar == "*" || scalar == "+" {
            return start + 1 < line.count && isSpaceOrTab(line[start + 1])
        }
        guard isASCIIDigit(scalar) else { return false }
        var end = start
        while end < line.count, isASCIIDigit(line[end]) { end += 1 }
        guard end - start <= 9, end < line.count, line[end] == "." else { return false }
        return end + 1 < line.count && isSpaceOrTab(line[end + 1])
    }

    /// `/^#{1,6}(?:[ \t]|$)/`
    private static func isHeadingMarker(_ line: Line, at start: Int) -> Bool {
        guard line[start] == "#" else { return false }
        var end = start
        while end < line.count, line[end] == "#" { end += 1 }
        guard end - start <= 6 else { return false }
        return end == line.count || isSpaceOrTab(line[end])
    }

    /// ``/^(?:`{3,}|~{3,})/``
    private static func isFenceMarker(_ line: Line, at start: Int) -> Bool {
        let scalar = line[start]
        guard scalar == "`" || scalar == "~" else { return false }
        var end = start
        while end < line.count, line[end] == scalar { end += 1 }
        return end - start >= 3
    }

    /// Column at which a list item's own content begins.
    private static func listContentColumn(_ line: Line) -> Int {
        let base = indentWidth(line)
        let start = contentStart(line)
        guard let marker = listMarkerWidth(line, at: start) else { return base }
        var column = base + marker.markerLength
        for index in marker.spaceStart..<marker.spaceEnd {
            column += line[index] == "\t" ? 4 - (column % 4) : 1
        }
        return column
    }

    /// `/^([-*+]|\d{1,9}\.)([ \t]+)/` against the line's content.
    private static func listMarkerWidth(
        _ line: Line, at start: Int
    ) -> (markerLength: Int, spaceStart: Int, spaceEnd: Int)? {
        guard start < line.count else { return nil }
        let scalar = line[start]
        var markerEnd: Int
        if scalar == "-" || scalar == "*" || scalar == "+" {
            markerEnd = start + 1
        } else if isASCIIDigit(scalar) {
            var end = start
            while end < line.count, isASCIIDigit(line[end]) { end += 1 }
            guard end - start <= 9, end < line.count, line[end] == "." else { return nil }
            markerEnd = end + 1
        } else {
            return nil
        }
        var spaceEnd = markerEnd
        while spaceEnd < line.count, isSpaceOrTab(line[spaceEnd]) { spaceEnd += 1 }
        guard spaceEnd > markerEnd else { return nil }
        return (markerEnd - start, markerEnd, spaceEnd)
    }

    /// Lines that belong to an INDENTED code block: a run opened by a blank
    /// line whose lines sit four or more columns past the enclosing container,
    /// ended by the first line that does not. Nothing else in this file detects
    /// indented code, so without this every stage happily deleted lines out of
    /// one.
    ///
    /// The threshold is relative to the innermost open list item's content
    /// column, so a bullet indented four spaces under an open list is still a
    /// nested list item; only four columns BEYOND the container is code. Fenced
    /// lines are never indented code - `scanFences` already owns them.
    private static func scanIndentedCode(_ lines: [Line], _ fences: FenceScan) -> [Bool] {
        var code: [Bool] = []
        code.reserveCapacity(lines.count)
        var listColumn = 0
        var inCode = false
        // The start of the document is a block boundary, like a blank line.
        var afterBlank = true

        for index in 0..<lines.count {
            let line = lines[index]
            if fences.inside[index] || fences.delimiter[index] {
                code.append(false)
                inCode = false
                afterBlank = false
                continue
            }
            if isBlankLine(line) {
                // A blank line does not end an indented code block; it is part
                // of one as long as an indented line follows.
                code.append(false)
                afterBlank = true
                continue
            }
            let width = indentWidth(line)
            if inCode || afterBlank, width >= listColumn + 4 {
                inCode = true
                afterBlank = false
                code.append(true)
                continue
            }
            inCode = false
            afterBlank = false
            code.append(false)
            let kind = markerKind(line)
            if kind == .list {
                let column = listContentColumn(line)
                listColumn = listColumn > 0 ? min(listColumn, column) : column
            } else if width < listColumn {
                listColumn = 0
            }
        }
        return code
    }

    /// Split a line into alternating plain (even index) and code-span (odd
    /// index) segments. Code spans pair by backtick RUN LENGTH, so "``a`b``" is
    /// one span; a single-backtick splitter tore it in half.
    private static func splitInlineCode(_ line: Line) -> [Line] {
        var segments: [Line] = []
        var plain: Line = []
        var index = 0
        while index < line.count {
            guard line[index] == "`" else {
                plain.append(line[index])
                index += 1
                continue
            }
            var openEnd = index
            while openEnd < line.count, line[openEnd] == "`" { openEnd += 1 }
            let runLength = openEnd - index
            var cursor = openEnd
            var closeEnd = -1
            while cursor < line.count {
                guard line[cursor] == "`" else {
                    cursor += 1
                    continue
                }
                var end = cursor
                while end < line.count, line[end] == "`" { end += 1 }
                if end - cursor == runLength {
                    closeEnd = end
                    break
                }
                cursor = end
            }
            if closeEnd == -1 {
                plain.append(contentsOf: line[index..<openEnd])
                index = openEnd
                continue
            }
            segments.append(plain)
            plain = []
            segments.append(Line(line[index..<closeEnd]))
            index = closeEnd
        }
        segments.append(plain)
        return segments
    }

    /// The prefix a continuation line must repeat to stay inside the same
    /// container as `line`: its indent, its blockquote markers, and - inside a
    /// list item - blanks as wide as the marker so the text lands on the item's
    /// content column.
    private static func continuationPrefix(_ line: Line) -> Line {
        // `/^[ \t]*(?:>[ \t]?)+/`
        var quoteEnd = 0
        var scan = 0
        while scan < line.count, isSpaceOrTab(line[scan]) { scan += 1 }
        if scan < line.count, line[scan] == ">" {
            var cursor = scan
            while cursor < line.count, line[cursor] == ">" {
                cursor += 1
                if cursor < line.count, isSpaceOrTab(line[cursor]) { cursor += 1 }
            }
            quoteEnd = cursor
        }
        let prefix = Line(line[0..<quoteEnd])
        let rest = Line(line[quoteEnd...])
        let start = contentStart(rest)
        let indent = Line(rest[0..<start])
        guard let marker = listMarkerWidth(rest, at: start) else { return prefix + indent }
        let padding = marker.markerLength + (marker.spaceEnd - marker.spaceStart)
        return prefix + indent + Line(repeating: " ", count: padding)
    }

    // MARK: - HTML patterns

    // Neither renderer interprets raw HTML: react-markdown escapes it
    // (rehype-raw would be an XSS hole for model output) and markdown-it with
    // html:true routes html_block/html_inline to renderRules.unknown, which
    // draws nothing at all. So the tags are removed and their text kept.
    private static let htmlTagNames =
        "a|abbr|article|aside|b|blockquote|body|button|center|cite|code|dd|del|div|dl|dt|em"
        + "|figcaption|figure|font|form|h[1-6]|head|header|hr|html|i|iframe|img|input|ins|kbd"
        + "|li|main|mark|nav|nobr|object|ol|p|pre|q|s|samp|script|section|small|span|strong"
        + "|style|sub|sup|svg|table|tbody|td|th|thead|tr|u|ul|var|wbr"

    // One attribute: a name, "=", and a quoted or bare value. Requiring the "="
    // is what tells a real tag from prose that happens to sit in brackets.
    private static let htmlAttributeSource =
        "[ \\t\\r\\n]+[A-Za-z_:][A-Za-z0-9_.:-]*[ \\t]*=[ \\t]*(?:\"[^\"]*\"|'[^']*'|[^ \\t>]*)"

    private static func makeRegex(_ pattern: String) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }

    // NSRegularExpression is documented as thread-safe for matching; the
    // patterns are compile-time constants, so a shared instance is correct and
    // avoids recompiling one per line.
    private static let scriptBlockRegex =
        makeRegex("<(script|style)\\b[^>]*>[\\s\\S]*?</\\1>")
    private static let commentRegex = makeRegex("<!--[\\s\\S]*?-->")
    private static let breakRegex = makeRegex("<br[ \\t]*/?>")
    private static let tagRegex = makeRegex(
        "</?(?:" + htmlTagNames + ")\\b(?:[ \\t]*/?>|(?:" + htmlAttributeSource + ")+[ \\t\\r\\n]*/?>)"
    )

    private static func stripHtmlFromSegment(_ segment: String) -> String {
        guard segment.unicodeScalars.contains("<") else { return segment }
        var result = segment
        for regex in [scriptBlockRegex, commentRegex, tagRegex] {
            guard let regex else { continue }
            result = regex.stringByReplacingMatches(
                in: result,
                range: NSRange(location: 0, length: (result as NSString).length),
                withTemplate: ""
            )
        }
        return result
    }

    /// `segment.split(/<br[ \t]*\/?>/i)` - every occurrence, no capture groups.
    private static func splitOnHtmlBreaks(_ segment: String) -> [String] {
        guard let breakRegex, segment.unicodeScalars.contains("<") else { return [segment] }
        let text = segment as NSString
        let matches = breakRegex.matches(
            in: segment, range: NSRange(location: 0, length: text.length)
        )
        guard !matches.isEmpty else { return [segment] }
        var parts: [String] = []
        var cursor = 0
        for match in matches {
            parts.append(
                text.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            )
            cursor = match.range.location + match.range.length
        }
        parts.append(text.substring(from: cursor))
        return parts
    }

    // MARK: - Scalar and string primitives

    private static func isSpaceOrTab(_ scalar: Unicode.Scalar) -> Bool {
        scalar == " " || scalar == "\t"
    }

    private static func isASCIIDigit(_ scalar: Unicode.Scalar) -> Bool {
        scalar.value >= 0x30 && scalar.value <= 0x39
    }

    /// `/[0-9A-Za-z]/`
    private static func isASCIIAlphanumeric(_ scalar: Unicode.Scalar) -> Bool {
        let value = scalar.value
        return (value >= 0x30 && value <= 0x39)
            || (value >= 0x41 && value <= 0x5A)
            || (value >= 0x61 && value <= 0x7A)
    }

    /// The set JS `String.prototype.trim` removes: WhiteSpace plus
    /// LineTerminator plus U+FEFF. Applied per SCALAR, matching the TS, which
    /// trims per UTF-16 unit - a combining mark is not whitespace either way.
    private static func isJSWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar {
        case " ", "\t", "\n", "\r", "\u{0B}", "\u{0C}", "\u{A0}", "\u{FEFF}",
             "\u{1680}", "\u{2028}", "\u{2029}", "\u{202F}", "\u{205F}", "\u{3000}":
            return true
        case "\u{2000}"..."\u{200A}":
            return true
        default:
            return false
        }
    }

    private static func isBlankLine(_ line: Line) -> Bool {
        line.allSatisfy(isJSWhitespace)
    }

    private static func firstNonBlank(_ line: Line) -> Unicode.Scalar? {
        line.first { !isJSWhitespace($0) }
    }

    private static func trimTrailingSpacesAndTabs(_ line: Line) -> Line {
        var end = line.count
        while end > 0, isSpaceOrTab(line[end - 1]) { end -= 1 }
        return Line(line[0..<end])
    }

    /// `String.prototype.trimEnd` expressed over the line array: trailing
    /// whitespace comes off the last line, and a last line left empty takes the
    /// newline before it with it.
    private static func trimEndLines(_ input: [Line]) -> [Line] {
        var lines = input
        while !lines.isEmpty {
            var last = lines[lines.count - 1]
            while let scalar = last.last, isJSWhitespace(scalar) { last.removeLast() }
            lines[lines.count - 1] = last
            if last.isEmpty, lines.count > 1 { lines.removeLast() } else { break }
        }
        return lines
    }

    private static func scalarString<S: Sequence>(_ scalars: S) -> String
    where S.Element == Unicode.Scalar {
        var view = String.UnicodeScalarView()
        for scalar in scalars { view.append(scalar) }
        return String(view)
    }

    /// `text.replace(/\r\n?/g, "\n")`.
    private static func normalizeLineEndings(_ text: String) -> String {
        guard text.unicodeScalars.contains("\r") else { return text }
        let scalars = Array(text.unicodeScalars)
        var view = String.UnicodeScalarView()
        view.reserveCapacity(scalars.count)
        var index = 0
        while index < scalars.count {
            if scalars[index] == "\r" {
                view.append("\n")
                index += (index + 1 < scalars.count && scalars[index + 1] == "\n") ? 2 : 1
            } else {
                view.append(scalars[index])
                index += 1
            }
        }
        return String(view)
    }

    /// `text.split("\n")`, done over scalars because Swift's `Character` folds
    /// a CRLF pair into one grapheme and `components(separatedBy: "\n")` will
    /// not split inside it.
    private static func splitLines(_ text: String) -> [Line] {
        var lines: [Line] = []
        var current: Line = []
        for scalar in text.unicodeScalars {
            if scalar == "\n" {
                lines.append(current)
                current = []
            } else {
                current.append(scalar)
            }
        }
        lines.append(current)
        return lines
    }

    private static func joinLines(_ lines: [Line]) -> String {
        var view = String.UnicodeScalarView()
        var total = 0
        for line in lines { total += line.count + 1 }
        view.reserveCapacity(total)
        for (index, line) in lines.enumerated() {
            if index > 0 { view.append("\n") }
            for scalar in line { view.append(scalar) }
        }
        return String(view)
    }
}
