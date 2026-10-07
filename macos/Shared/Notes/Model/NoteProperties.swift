import Foundation

/// What a single custom note property can hold - the `NotePropertyValue`
/// union in `mobile/src/features/notes/types.ts`, and exactly the shapes
/// `validateProperties` (`src/lib/note-links.ts`) accepts: a string, a finite
/// number, a boolean, or an array of strings.
enum NotePropertyValue: Sendable, Equatable, Codable {
    case text(String)
    case number(Double)
    case checkbox(Bool)
    case list([String])

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        // Bool first: JSONDecoder will not read `true` as a number, but the
        // order keeps that independent of decoder leniency.
        if let value = try? container.decode(Bool.self) {
            self = .checkbox(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .text(value)
        } else if let value = try? container.decode([String].self) {
            self = .list(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported note property value"
            )
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .text(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .checkbox(let value): try container.encode(value)
        case .list(let value): try container.encode(value)
        }
    }
}

typealias NoteProperties = [String: NotePropertyValue]

extension Dictionary where Key == String, Value == NotePropertyValue {
    /// Narrow a server `properties` column. Null and non-objects mean "none";
    /// an entry of a shape the server would never have accepted is dropped
    /// rather than failing the note it rides on.
    init?(json: JSONValue) {
        guard case .object(let object) = json else { return nil }
        var result: NoteProperties = [:]
        for (key, value) in object {
            switch value {
            case .string(let text): result[key] = .text(text)
            case .number(let number) where number.isFinite: result[key] = .number(number)
            case .bool(let flag): result[key] = .checkbox(flag)
            case .array(let items):
                let strings = items.compactMap(\.stringValue)
                if strings.count == items.count { result[key] = .list(strings) }
            default: continue
            }
        }
        self = result
    }
}

/// The editor types a property can take - `NotePropertyType` in
/// `mobile/src/features/notes/noteProperties.ts`.
enum NotePropertyType: String, Sendable, CaseIterable, Identifiable {
    case text, number, checkbox, list

    var id: String { rawValue }

    var label: String {
        switch self {
        case .text: "Text"
        case .number: "Number"
        case .checkbox: "Checkbox"
        case .list: "List"
        }
    }

    var placeholder: String {
        switch self {
        case .text: "Value"
        case .number: "0"
        case .checkbox: ""
        case .list: "Comma separated"
        }
    }
}

/// Editing helpers for note metadata - a port of
/// `mobile/src/features/notes/noteProperties.ts`. Every value the UI produces
/// goes through `parseValue`, so a malformed number or an empty list never
/// reaches the PATCH body.
enum NotePropertyEditing {

    static func type(of value: NotePropertyValue) -> NotePropertyType {
        switch value {
        case .list: .list
        case .number: .number
        case .checkbox: .checkbox
        case .text: .text
        }
    }

    /// Read-only rendering of a value.
    static func format(_ value: NotePropertyValue) -> String {
        switch value {
        case .list(let items): items.joined(separator: ", ")
        case .checkbox(let flag): flag ? "Yes" : "No"
        case .number(let number): formatNumber(number)
        case .text(let text): text
        }
    }

    /// Seeds the text field when an existing property is reopened for editing.
    static func input(for value: NotePropertyValue) -> String {
        switch value {
        case .list(let items): items.joined(separator: ", ")
        case .checkbox(let flag): flag ? "true" : "false"
        case .number(let number): formatNumber(number)
        case .text(let text): text
        }
    }

    /// JS `String(3)` is "3", not Swift's "3.0" - integral values print bare so
    /// a property reads the same on every client.
    static func formatNumber(_ number: Double) -> String {
        if number.isFinite, number == number.rounded(), abs(number) < 1e15 {
            return String(Int64(number))
        }
        return String(number)
    }

    /// Parse raw input for a chosen type. Returns nil when the input cannot
    /// make a valid value, which is what disables Save in the UI.
    static func parseValue(_ type: NotePropertyType, _ raw: String) -> NotePropertyValue? {
        switch type {
        case .number:
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, let parsed = Double(trimmed), parsed.isFinite else { return nil }
            return .number(parsed)
        case .checkbox:
            switch raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "true": return .checkbox(true)
            case "false": return .checkbox(false)
            default: return nil
            }
        case .list:
            let items = raw.split(separator: ",", omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            return items.isEmpty ? nil : .list(items)
        case .text:
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : .text(trimmed)
        }
    }

    /// Keys are compared case-insensitively, so only whitespace is normalized.
    static func normalizeKey(_ raw: String) -> String {
        raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// True when `key` would collide with an existing one, ignoring
    /// `ignoreKey` (the row being edited).
    static func keyTaken(_ properties: NoteProperties?, _ key: String, ignoring ignoreKey: String? = nil) -> Bool {
        let needle = normalizeKey(key).lowercased()
        guard !needle.isEmpty else { return false }
        return (properties ?? [:]).keys.contains { existing in
            existing != ignoreKey && existing.lowercased() == needle
        }
    }

    /// Alphabetical (locale-aware, like JS `localeCompare`) so the sheet does
    /// not reshuffle rows after every edit.
    static func entries(_ properties: NoteProperties?) -> [(key: String, value: NotePropertyValue)] {
        (properties ?? [:])
            .map { (key: $0.key, value: $0.value) }
            .sorted { $0.key.localizedCompare($1.key) == .orderedAscending }
    }

    /// Writing under a renamed key drops the old one, so a rename is one PATCH.
    static func setting(
        _ properties: NoteProperties?,
        key: String,
        value: NotePropertyValue,
        previousKey: String? = nil
    ) -> NoteProperties {
        var next = properties ?? [:]
        if let previousKey, previousKey != key { next.removeValue(forKey: previousKey) }
        next[key] = value
        return next
    }

    static func removing(_ properties: NoteProperties?, key: String) -> NoteProperties {
        var next = properties ?? [:]
        next.removeValue(forKey: key)
        return next
    }

    /// Trim, drop blanks, and keep the first spelling of any case-insensitive
    /// duplicate.
    static func normalizeAliases(_ aliases: [String]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for alias in aliases {
            let trimmed = alias.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            guard !trimmed.isEmpty else { continue }
            let key = trimmed.lowercased()
            guard seen.insert(key).inserted else { continue }
            result.append(trimmed)
        }
        return result
    }
}
