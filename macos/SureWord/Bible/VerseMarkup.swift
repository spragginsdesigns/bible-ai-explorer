import Foundation

/// A run of verse text with one emphasis state.
struct BibleVerseSegment: Sendable, Equatable {
    var text: String
    var italic: Bool
}

/// bolls.life marks supplied words with inline HTML italics. SwiftUI `Text`
/// does not interpret HTML, so translate only the supported emphasis tags into
/// safe segments and discard any other provider markup.
///
/// Port of `mobile/src/features/bible/verseMarkup.ts`.
enum VerseMarkup {
    static func segments(_ markup: String) -> [BibleVerseSegment] {
        let characters = Array(markup)
        var segments: [BibleVerseSegment] = []
        var italicDepth = 0
        var cursor = 0
        var index = 0

        func append(_ raw: ArraySlice<Character>) {
            let text = decodeEntities(String(raw))
            guard !text.isEmpty else { return }
            let italic = italicDepth > 0
            if let last = segments.last, last.italic == italic {
                segments[segments.count - 1].text += text
            } else {
                segments.append(BibleVerseSegment(text: text, italic: italic))
            }
        }

        while index < characters.count {
            guard characters[index] == "<" else {
                index += 1
                continue
            }
            var close = index + 1
            while close < characters.count, characters[close] != ">" { close += 1 }
            // `<[^>]*>` needs its closing bracket; an unterminated "<" is text.
            guard close < characters.count else { break }

            append(characters[cursor..<index])
            let tag = String(characters[index...close]).lowercased()
            if isOpeningEmphasis(tag) {
                italicDepth += 1
            } else if isClosingEmphasis(tag) {
                italicDepth = max(0, italicDepth - 1)
            }
            cursor = close + 1
            index = close + 1
        }

        append(characters[cursor...])
        return segments
    }

    /// The markup with every tag removed and entities decoded — what copy,
    /// share, save-to-note and Ask-AI send.
    static func plainText(_ markup: String) -> String {
        segments(markup).map(\.text).joined()
    }

    // MARK: - Tags

    /// `^<(i|em)(?:\s[^>]*)?>$`
    private static func isOpeningEmphasis(_ tag: String) -> Bool {
        guard tag.hasPrefix("<"), tag.hasSuffix(">") else { return false }
        let inner = tag.dropFirst().dropLast()
        for name in ["i", "em"] where inner.hasPrefix(name) {
            let rest = inner.dropFirst(name.count)
            if rest.isEmpty { return true }
            if let first = rest.first, first.isWhitespace { return true }
        }
        return false
    }

    /// `^</(i|em)\s*>$`
    private static func isClosingEmphasis(_ tag: String) -> Bool {
        guard tag.hasPrefix("</"), tag.hasSuffix(">") else { return false }
        let inner = tag.dropFirst(2).dropLast().trimmingCharacters(in: .whitespaces)
        return inner == "i" || inner == "em"
    }

    // MARK: - Entities

    /// `&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);`, case-insensitive.
    /// Anything else is left exactly as written.
    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        let characters = Array(text)
        var result = ""
        var index = 0

        while index < characters.count {
            guard characters[index] == "&" else {
                result.append(characters[index])
                index += 1
                continue
            }
            var end = index + 1
            while end < characters.count, characters[end] != ";", end - index <= 12 { end += 1 }
            guard end < characters.count, characters[end] == ";",
                  let decoded = decode(entity: String(characters[(index + 1)..<end]))
            else {
                result.append(characters[index])
                index += 1
                continue
            }
            result.append(decoded)
            index = end + 1
        }
        return result
    }

    private static func decode(entity: String) -> String? {
        let name = entity.lowercased()
        if name.hasPrefix("#x") {
            guard let value = UInt32(name.dropFirst(2), radix: 16),
                  let scalar = Unicode.Scalar(value) else { return nil }
            return String(Character(scalar))
        }
        if name.hasPrefix("#") {
            guard let value = UInt32(name.dropFirst()),
                  let scalar = Unicode.Scalar(value) else { return nil }
            return String(Character(scalar))
        }
        switch name {
        case "amp": return "&"
        case "apos": return "'"
        case "gt": return ">"
        case "lt": return "<"
        case "nbsp": return " "
        case "quot": return "\""
        default: return nil
        }
    }
}
