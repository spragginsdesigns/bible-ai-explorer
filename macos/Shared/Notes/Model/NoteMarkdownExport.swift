import Foundation

/// "Copy as Markdown" / "Share as Markdown": a line-for-line Swift port of
/// `mobile/src/features/notes/noteMarkdownExport.ts` (`noteDocumentToMarkdown`).
///
/// The TS original walks the live Tiptap JSON document, so this does too: the
/// input is a Tiptap node tree (`JSONValue`), and `NoteTiptapDocument` builds
/// that tree from this client's own `NoteDocument`. Keeping the exporter on the
/// same input shape is what lets `NoteMarkdownExportTests` assert byte-equal
/// output against fixtures produced by running the TS implementation
/// (`macos/scripts/generate-port-fixtures.mjs`), including the errors it
/// throws and the JavaScript coercions it leans on (`Number(...)`,
/// truthiness, `String(...)`).
enum NoteMarkdownExport {
    struct ExportError: Error, Equatable, LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static let notReady = "The editor is not ready. Please try again."
    static let unsupportedContent = "This note contains content that cannot be exported yet."
    static let unsupportedFormatting = "This note contains formatting that cannot be exported yet."
    static let invalidListItem = "Invalid list item."

    static func markdown(title: String, document: JSONValue) throws -> String {
        guard document["type"]?.stringValue == "doc", let content = document["content"]?.arrayValue else {
            throw ExportError(message: notReady)
        }
        let trimmedTitle = jsTrim(title)
        let noteTitle = trimmedTitle.isEmpty ? "Untitled Note" : trimmedTitle
        var children = content
        if let first = content.first,
           first["type"]?.stringValue == "heading",
           first["attrs"]?["level"]?.doubleValue == 1 {
            let text = (first["content"]?.arrayValue ?? []).map { $0["text"]?.stringValue ?? "" }.joined()
            if jsTrim(text).lowercased() == noteTitle.lowercased() {
                children = Array(content.dropFirst())
            }
        }
        let body = jsTrim(try block(.object(["type": .string("doc"), "content": .array(children)])))
        return "# \(noteTitle)\(body.isEmpty ? "" : "\n\n\(body)")\n"
    }

    // MARK: Blocks

    private static func block(_ node: JSONValue) throws -> String {
        let children = node["content"]?.arrayValue ?? []
        switch node["type"]?.stringValue {
        case "doc":
            return try children.map(block).joined(separator: "\n\n")
        case "paragraph":
            return try children.map(inline).joined()
        case "heading":
            let raw = jsNumber(node["attrs"]?["level"])
            let level = (raw.isNaN || raw == 0) ? 1 : raw
            let count = Int(min(6, max(1, level)))
            return String(repeating: "#", count: count) + " " + (try children.map(inline).joined())
        case "blockquote":
            return try children.map(block).joined(separator: "\n\n")
                .components(separatedBy: "\n")
                .map { "> " + $0 }
                .joined(separator: "\n")
        case "bulletList", "orderedList", "taskList":
            let kind = node["type"]?.stringValue
            return try children.enumerated().map { index, item in
                guard let itemType = item["type"]?.stringValue, itemType == "listItem" || itemType == "taskItem" else {
                    throw ExportError(message: invalidListItem)
                }
                let marker: String
                if kind == "taskList" {
                    marker = "- [\(jsTruthy(item["attrs"]?["checked"]) ? "x" : " ")] "
                } else if kind == "orderedList" {
                    let startValue = node["attrs"]?["start"]
                    let start = (startValue == nil || startValue == .null) ? 1 : jsNumber(startValue)
                    marker = "\(jsNumberString(start + Double(index))). "
                } else {
                    marker = "- "
                }
                let body = try (item["content"]?.arrayValue ?? []).map(block).joined(separator: "\n\n")
                return marker + body.replacingOccurrences(of: "\n", with: "\n    ")
            }.joined(separator: "\n")
        case "codeBlock":
            let text = children.map { $0["text"]?.stringValue ?? "" }.joined()
            let fence = String(repeating: "`", count: max(3, longestBacktickRun(text) + 1))
            let language = jsString(node["attrs"]?["language"]).filter {
                $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "+" || $0 == "-")
            }
            return "\(fence)\(language)\n\(text)\n\(fence)"
        case "horizontalRule":
            return "---"
        default:
            throw ExportError(message: unsupportedContent)
        }
    }

    // MARK: Inline

    private static func inline(_ node: JSONValue) throws -> String {
        if node["type"]?.stringValue == "hardBreak" { return "  \n" }
        guard node["type"]?.stringValue == "text", let raw = node["text"]?.stringValue else {
            throw ExportError(message: unsupportedContent)
        }
        let marks = node["marks"]?.arrayValue ?? []
        let isCode = marks.contains { $0["type"]?.stringValue == "code" }
        var text = isCode ? raw : prose(raw)
        for mark in marks {
            switch mark["type"]?.stringValue {
            case "bold": text = "**\(text)**"
            case "italic": text = "*\(text)*"
            case "strike": text = "~~\(text)~~"
            case "underline": text = "<u>\(text)</u>"
            case "highlight": text = "==\(text)=="
            case "code":
                let fence = String(repeating: "`", count: max(1, longestBacktickRun(text) + 1))
                text = "\(fence) \(text) \(fence)"
            case "link":
                var href = jsString(mark["attrs"]?["href"])
                href = href.replacingOccurrences(of: "\\", with: "%5C")
                    .replacingOccurrences(of: "(", with: "%28")
                    .replacingOccurrences(of: ")", with: "%29")
                href = String(href.unicodeScalars.map { jsWhitespace.contains($0) ? "%20" : String($0) }.joined())
                text = "[\(text)](\(href))"
            default:
                throw ExportError(message: unsupportedFormatting)
            }
        }
        return text
    }

    /// Markdown-escape prose, leaving `[[wikilinks]]` untouched.
    static func prose(_ text: String) -> String {
        var output = ""
        var cursor = text.startIndex
        for match in text.matches(of: /\[\[[^\[\]]+?\]\]/) {
            output += escapeProse(String(text[cursor..<match.range.lowerBound]))
            output += String(text[match.range])
            cursor = match.range.upperBound
        }
        output += escapeProse(String(text[cursor...]))
        return output
    }

    private static func escapeProse(_ text: String) -> String {
        var escaped = ""
        for character in text {
            if "\\`*_[]<>".contains(character) { escaped.append("\\") }
            escaped.append(character)
        }
        // `^(\s*)([-+=#~])` and `^(\s*\d+)([.)])(?=\s)`, both with the `m` flag:
        // a line that would start a list, heading or rule keeps its literal text.
        escaped = replacing(escaped, pattern: "^(\\s*)([-+=#~])", with: "$1\\\\$2")
        escaped = replacing(escaped, pattern: "^(\\s*[0-9]+)([.)])(?=\\s)", with: "$1\\\\$2")
        return escaped
    }

    private static func replacing(_ text: String, pattern: String, with template: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines]) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: template)
    }

    private static func longestBacktickRun(_ text: String) -> Int {
        var longest = 0
        var current = 0
        for character in text {
            if character == "`" {
                current += 1
                longest = max(longest, current)
            } else {
                current = 0
            }
        }
        return longest
    }

    // MARK: JavaScript coercions the TS original relies on

    /// JS `\s`.
    private static let jsWhitespace: Set<Unicode.Scalar> = [
        "\u{0009}", "\u{000A}", "\u{000B}", "\u{000C}", "\u{000D}", "\u{0020}", "\u{00A0}", "\u{1680}",
        "\u{2000}", "\u{2001}", "\u{2002}", "\u{2003}", "\u{2004}", "\u{2005}", "\u{2006}", "\u{2007}",
        "\u{2008}", "\u{2009}", "\u{200A}", "\u{2028}", "\u{2029}", "\u{202F}", "\u{205F}", "\u{3000}",
        "\u{FEFF}",
    ]

    /// `String.prototype.trim`.
    static func jsTrim(_ text: String) -> String {
        let scalars = text.unicodeScalars
        guard let start = scalars.firstIndex(where: { !jsWhitespace.contains($0) }),
              let end = scalars.lastIndex(where: { !jsWhitespace.contains($0) })
        else { return "" }
        return String(scalars[start...end])
    }

    /// `Number(value)`; a missing value is `undefined`, i.e. NaN.
    private static func jsNumber(_ value: JSONValue?) -> Double {
        switch value {
        case nil: return .nan
        case .null?: return 0
        case .bool(let flag)?: return flag ? 1 : 0
        case .number(let number)?: return number
        case .string(let string)?:
            let trimmed = jsTrim(string)
            return trimmed.isEmpty ? 0 : (Double(trimmed) ?? .nan)
        default: return .nan
        }
    }

    /// `String(number)` for the values a list start can produce.
    private static func jsNumberString(_ value: Double) -> String {
        if value.isNaN { return "NaN" }
        if value.isInfinite { return value > 0 ? "Infinity" : "-Infinity" }
        if value == value.rounded(), abs(value) < 1e21 { return String(Int64(value)) }
        return String(value)
    }

    /// `String(value ?? "")`.
    private static func jsString(_ value: JSONValue?) -> String {
        switch value {
        case nil, .null?: return ""
        case .string(let string)?: return string
        case .bool(let flag)?: return flag ? "true" : "false"
        case .number(let number)?: return jsNumberString(number)
        case .array?: return ""
        case .object?: return "[object Object]"
        }
    }

    /// JavaScript truthiness.
    private static func jsTruthy(_ value: JSONValue?) -> Bool {
        switch value {
        case nil, .null?: return false
        case .bool(let flag)?: return flag
        case .number(let number)?: return number != 0 && !number.isNaN
        case .string(let string)?: return !string.isEmpty
        case .array?, .object?: return true
        }
    }
}
