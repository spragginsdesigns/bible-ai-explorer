import Foundation

/// Block-level Markdown structure for chat answers and notes.
///
/// The Android client gets this from `react-native-markdown-display`
/// (`mobile/src/features/chat/MarkdownBody.tsx`); SwiftUI's `AttributedString`
/// only understands *inline* Markdown, so the block grammar the model actually
/// emits — Scripture blockquotes, headings, lists, fenced code, tables, rules —
/// is parsed here and rendered by `MarkdownBody`.
enum MarkdownBlock: Equatable {
    case paragraph(String)
    case heading(level: Int, text: String)
    /// One quote, split into its paragraphs (blank `>` lines separate them).
    case blockquote(paragraphs: [String])
    case list(ordered: Bool, start: Int, items: [MarkdownListItem])
    case codeBlock(language: String?, code: String)
    case table(header: [String], rows: [[String]])
    case rule
}

struct MarkdownListItem: Equatable {
    var text: String
    var children: [MarkdownListItem] = []
}

enum MarkdownDocument {
    static func parse(_ text: String) -> [MarkdownBlock] {
        let lines = text.components(separatedBy: "\n").map {
            $0.hasSuffix("\r") ? String($0.dropLast()) : $0
        }
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var index = 0

        func flushParagraph() {
            let body = paragraph.joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !body.isEmpty { blocks.append(.paragraph(body)) }
            paragraph = []
        }

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty {
                flushParagraph()
                index += 1
                continue
            }

            if let fence = fenceMarker(trimmed) {
                flushParagraph()
                let language = String(trimmed.drop(while: { $0 == fence }))
                    .trimmingCharacters(in: .whitespaces)
                var code: [String] = []
                index += 1
                while index < lines.count {
                    let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                    if fenceMarker(candidate) == fence { index += 1; break }
                    code.append(lines[index])
                    index += 1
                }
                blocks.append(
                    .codeBlock(
                        language: language.isEmpty ? nil : language,
                        code: code.joined(separator: "\n")
                    )
                )
                continue
            }

            if isRule(trimmed) {
                flushParagraph()
                blocks.append(.rule)
                index += 1
                continue
            }

            if let heading = headingMatch(trimmed) {
                flushParagraph()
                blocks.append(.heading(level: heading.level, text: heading.text))
                index += 1
                continue
            }

            if trimmed.hasPrefix(">") {
                flushParagraph()
                var quoteParagraphs: [String] = []
                var current: [String] = []
                while index < lines.count {
                    let quoteLine = lines[index].trimmingCharacters(in: .whitespaces)
                    guard quoteLine.hasPrefix(">") else { break }
                    let content = stripQuoteMarker(quoteLine)
                    if content.isEmpty {
                        if !current.isEmpty {
                            quoteParagraphs.append(current.joined(separator: "\n"))
                            current = []
                        }
                    } else {
                        current.append(content)
                    }
                    index += 1
                }
                if !current.isEmpty { quoteParagraphs.append(current.joined(separator: "\n")) }
                if !quoteParagraphs.isEmpty {
                    blocks.append(.blockquote(paragraphs: quoteParagraphs))
                }
                continue
            }

            if let marker = listMarker(line) {
                flushParagraph()
                let ordered = marker.ordered
                let start = marker.number ?? 1
                var items: [MarkdownListItem] = []
                while index < lines.count {
                    guard let item = listMarker(lines[index]), item.ordered == ordered else { break }
                    if item.indent >= 2, !items.isEmpty {
                        items[items.count - 1].children.append(MarkdownListItem(text: item.text))
                    } else {
                        items.append(MarkdownListItem(text: item.text))
                    }
                    index += 1
                }
                blocks.append(.list(ordered: ordered, start: start, items: items))
                continue
            }

            if trimmed.hasPrefix("|"),
               index + 1 < lines.count,
               isTableSeparator(lines[index + 1].trimmingCharacters(in: .whitespaces)) {
                flushParagraph()
                let header = tableCells(trimmed)
                var rows: [[String]] = []
                index += 2
                while index < lines.count {
                    let rowLine = lines[index].trimmingCharacters(in: .whitespaces)
                    guard rowLine.hasPrefix("|") else { break }
                    rows.append(tableCells(rowLine))
                    index += 1
                }
                blocks.append(.table(header: header, rows: rows))
                continue
            }

            paragraph.append(line)
            index += 1
        }

        flushParagraph()
        return blocks
    }

    // MARK: Line classifiers

    private static func fenceMarker(_ trimmed: String) -> Character? {
        for fence: Character in ["`", "~"] where trimmed.hasPrefix(String(repeating: fence, count: 3)) {
            return fence
        }
        return nil
    }

    /// `---`, `***`, `___` (3+, spaces allowed between) — checked before list
    /// markers so `- - -` isn't taken for a bullet.
    private static func isRule(_ trimmed: String) -> Bool {
        let compact = trimmed.replacingOccurrences(of: " ", with: "")
        guard compact.count >= 3, let first = compact.first, "-*_".contains(first) else { return false }
        return compact.allSatisfy { $0 == first }
    }

    private static func headingMatch(_ trimmed: String) -> (level: Int, text: String)? {
        guard trimmed.hasPrefix("#") else { return nil }
        let hashes = trimmed.prefix(while: { $0 == "#" })
        guard hashes.count <= 6 else { return nil }
        let rest = trimmed.dropFirst(hashes.count)
        guard rest.first == " " else { return nil }
        // Trailing closing hashes (`## Title ##`) are decoration, not content.
        let text = rest.trimmingCharacters(in: .whitespaces)
            .reversed().drop(while: { $0 == "#" }).reversed()
        return (hashes.count, String(text).trimmingCharacters(in: .whitespaces))
    }

    private static func stripQuoteMarker(_ line: String) -> String {
        var content = line.dropFirst()
        if content.first == " " { content = content.dropFirst() }
        return String(content).trimmingCharacters(in: .whitespaces)
    }

    private static func listMarker(_ line: String) -> (ordered: Bool, number: Int?, indent: Int, text: String)? {
        let indent = line.prefix(while: { $0 == " " }).count
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        for bullet in ["- ", "* ", "+ "] where trimmed.hasPrefix(bullet) {
            return (false, nil, indent, String(trimmed.dropFirst(2)).trimmingCharacters(in: .whitespaces))
        }

        let digits = trimmed.prefix(while: \.isNumber)
        guard !digits.isEmpty, digits.count <= 9 else { return nil }
        let rest = trimmed.dropFirst(digits.count)
        guard rest.hasPrefix(". ") || rest.hasPrefix(") ") else { return nil }
        return (true, Int(digits), indent, String(rest.dropFirst(2)).trimmingCharacters(in: .whitespaces))
    }

    private static func isTableSeparator(_ trimmed: String) -> Bool {
        guard trimmed.contains("-") else { return false }
        return !trimmed.isEmpty && trimmed.allSatisfy { "|-: ".contains($0) }
    }

    private static func tableCells(_ line: String) -> [String] {
        var cells = line.components(separatedBy: "|").map {
            $0.trimmingCharacters(in: .whitespaces)
        }
        // A leading/trailing `|` produces empty edge cells that aren't columns.
        if cells.first?.isEmpty == true { cells.removeFirst() }
        if cells.last?.isEmpty == true { cells.removeLast() }
        return cells
    }
}
