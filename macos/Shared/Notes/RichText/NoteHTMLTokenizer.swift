import Foundation

/// A deliberately small HTML tokenizer, scoped to the markup the SureWord
/// clients actually store: Tiptap's `getHTML()` output and the `marked` output
/// the backend writes through `markdownToNoteHtml`.
///
/// It is tolerant rather than conformant — an unclosed tag or an unknown
/// element degrades one run of text instead of throwing away a note. Anything
/// it cannot classify (comments, doctypes, processing instructions) is dropped,
/// which matches what a browser would render.
enum NoteHTMLTokenizer {

    enum Token: Equatable {
        case text(String)
        case open(name: String, attributes: [HTMLAttribute], isSelfClosing: Bool)
        case close(name: String)
    }

    /// Elements that never have a closing tag.
    static let voidElements: Set<String> = [
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
    ]

    static func tokenize(_ html: String) -> [Token] {
        var tokens: [Token] = []
        var text = ""
        let scalars = Array(html)
        var index = 0

        func flushText() {
            if !text.isEmpty {
                tokens.append(.text(HTMLEntities.decode(text)))
                text = ""
            }
        }

        while index < scalars.count {
            guard scalars[index] == "<" else {
                text.append(scalars[index])
                index += 1
                continue
            }

            // `<` that isn't the start of a tag is literal text — a stray
            // less-than in a note body must not eat the rest of the document.
            guard index + 1 < scalars.count, isTagStart(scalars[index + 1]) else {
                text.append(scalars[index])
                index += 1
                continue
            }

            if let end = skipComment(scalars, from: index) {
                flushText()
                index = end
                continue
            }

            flushText()
            let (token, next) = readTag(scalars, from: index)
            if let token { tokens.append(token) }
            index = next
        }

        flushText()
        return tokens
    }

    // MARK: - Pieces

    private static func isTagStart(_ character: Character) -> Bool {
        character.isLetter || character == "/" || character == "!" || character == "?"
    }

    /// Consumes `<!-- … -->`, `<!doctype …>` and `<? … ?>`, returning the index
    /// just past them.
    private static func skipComment(_ scalars: [Character], from start: Int) -> Int? {
        if matches(scalars, at: start, "<!--") {
            var index = start + 4
            while index < scalars.count {
                if matches(scalars, at: index, "-->") { return index + 3 }
                index += 1
            }
            return scalars.count
        }
        if matches(scalars, at: start, "<!") || matches(scalars, at: start, "<?") {
            var index = start + 2
            while index < scalars.count, scalars[index] != ">" { index += 1 }
            return min(index + 1, scalars.count)
        }
        return nil
    }

    private static func matches(_ scalars: [Character], at index: Int, _ needle: String) -> Bool {
        let characters = Array(needle)
        guard index + characters.count <= scalars.count else { return false }
        for offset in 0..<characters.count where scalars[index + offset] != characters[offset] {
            return false
        }
        return true
    }

    private static func readTag(_ scalars: [Character], from start: Int) -> (Token?, Int) {
        var index = start + 1
        let isClosing = index < scalars.count && scalars[index] == "/"
        if isClosing { index += 1 }

        var name = ""
        while index < scalars.count, scalars[index].isLetter || scalars[index].isNumber {
            name.append(scalars[index])
            index += 1
        }
        name = name.lowercased()

        guard !name.isEmpty else {
            // `<>` or similar — skip to the closing bracket and drop it.
            while index < scalars.count, scalars[index] != ">" { index += 1 }
            return (nil, min(index + 1, scalars.count))
        }

        if isClosing {
            while index < scalars.count, scalars[index] != ">" { index += 1 }
            return (.close(name: name), min(index + 1, scalars.count))
        }

        var attributes: [HTMLAttribute] = []
        var isSelfClosing = false

        while index < scalars.count {
            while index < scalars.count, scalars[index].isWhitespace { index += 1 }
            guard index < scalars.count else { break }

            if scalars[index] == ">" {
                index += 1
                break
            }
            if scalars[index] == "/" {
                isSelfClosing = true
                index += 1
                continue
            }

            var attributeName = ""
            while index < scalars.count,
                  !scalars[index].isWhitespace,
                  scalars[index] != "=",
                  scalars[index] != ">",
                  scalars[index] != "/" {
                attributeName.append(scalars[index])
                index += 1
            }
            guard !attributeName.isEmpty else {
                index += 1
                continue
            }

            while index < scalars.count, scalars[index].isWhitespace { index += 1 }
            guard index < scalars.count, scalars[index] == "=" else {
                attributes.append(HTMLAttribute(attributeName.lowercased(), nil))
                continue
            }
            index += 1
            while index < scalars.count, scalars[index].isWhitespace { index += 1 }

            var value = ""
            if index < scalars.count, scalars[index] == "\"" || scalars[index] == "'" {
                let quote = scalars[index]
                index += 1
                while index < scalars.count, scalars[index] != quote {
                    value.append(scalars[index])
                    index += 1
                }
                index += 1
            } else {
                while index < scalars.count,
                      !scalars[index].isWhitespace,
                      scalars[index] != ">" {
                    value.append(scalars[index])
                    index += 1
                }
            }
            attributes.append(HTMLAttribute(attributeName.lowercased(), HTMLEntities.decode(value)))
        }

        if voidElements.contains(name) { isSelfClosing = true }
        return (.open(name: name, attributes: attributes, isSelfClosing: isSelfClosing), index)
    }
}

// MARK: - Entities

enum HTMLEntities {
    private static let named: [String: String] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'",
        "nbsp": "\u{00A0}", "mdash": "—", "ndash": "–", "hellip": "…",
        "lsquo": "\u{2018}", "rsquo": "\u{2019}", "ldquo": "\u{201C}",
        "rdquo": "\u{201D}", "copy": "©", "reg": "®", "trade": "™",
        "middot": "·", "bull": "•", "deg": "°", "laquo": "«", "raquo": "»",
    ]

    static func decode(_ text: String) -> String {
        guard text.contains("&") else { return text }

        var result = ""
        var index = text.startIndex

        while index < text.endIndex {
            guard text[index] == "&",
                  let semicolon = text[index...].firstIndex(of: ";"),
                  text.distance(from: index, to: semicolon) <= 10
            else {
                result.append(text[index])
                index = text.index(after: index)
                continue
            }

            let body = String(text[text.index(after: index)..<semicolon])
            if let decoded = decodeEntityBody(body) {
                result.append(decoded)
                index = text.index(after: semicolon)
            } else {
                result.append(text[index])
                index = text.index(after: index)
            }
        }
        return result
    }

    private static func decodeEntityBody(_ body: String) -> String? {
        if body.hasPrefix("#") {
            let digits = body.dropFirst()
            let value: UInt32?
            if digits.hasPrefix("x") || digits.hasPrefix("X") {
                value = UInt32(digits.dropFirst(), radix: 16)
            } else {
                value = UInt32(digits)
            }
            guard let value, let scalar = Unicode.Scalar(value) else { return nil }
            return String(Character(scalar))
        }
        return named[body] ?? named[body.lowercased()]
    }

    /// Escape for a text node. Browsers' `innerHTML` — which is what produces
    /// the HTML the other clients store — escapes exactly these, and leaves
    /// quotes and apostrophes alone.
    static func escapeText(_ text: String) -> String {
        var result = ""
        result.reserveCapacity(text.count)
        for character in text {
            switch character {
            case "&": result += "&amp;"
            case "<": result += "&lt;"
            case ">": result += "&gt;"
            case "\u{00A0}": result += "&nbsp;"
            default: result.append(character)
            }
        }
        return result
    }

    static func escapeAttribute(_ value: String) -> String {
        var result = ""
        result.reserveCapacity(value.count)
        for character in value {
            switch character {
            case "&": result += "&amp;"
            case "\"": result += "&quot;"
            case "<": result += "&lt;"
            case ">": result += "&gt;"
            case "\u{00A0}": result += "&nbsp;"
            default: result.append(character)
            }
        }
        return result
    }
}
