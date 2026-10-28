import Foundation

/// Pure Ways to Serve rules, mirrored by hand from `src/lib/serve-rules.ts`
/// (the mode list and limits) and `src/components/serve/serveActions.ts` (what
/// a way's button does). Changing one side without the other breaks parity.
///
/// Nothing here counts, scores or streaks anything a reader does: salvation is
/// by grace through faith, not works (Ephesians 2:8-9), and every way is an
/// invitation (Ephesians 2:10).

enum ServeMode: String, CaseIterable, Codable, Sendable, Identifiable {
    case off, nearby, online, both

    var id: String { rawValue }

    /// Online needs no location, so nobody is asked where they live to start.
    static let defaultMode: ServeMode = .online

    /// The server's `readServeMode`: anything unknown reads as the default.
    static func read(_ raw: String?) -> ServeMode {
        raw.flatMap(ServeMode.init(rawValue:)) ?? defaultMode
    }

    var label: String {
        switch self {
        case .off: "Off"
        case .nearby: "Nearby"
        case .online: "Online"
        case .both: "Both"
        }
    }
}

/// What a way's button does. Raw values are the server's wire strings.
enum ServeAction: String, Codable, Sendable, CaseIterable {
    case shareVerse = "share-verse"
    case pray
    case reachOut = "reach-out"
    case nearby
    case church
    case giveChurch = "give-church"
    case giveNeed = "give-need"
    case journal
}

/// Where a way's button goes on Apple, the counterpart of the web's
/// `ServeActionTarget`.
enum ServeActionTarget: Equatable, Sendable {
    /// The existing "Send a word" sheet, seeded with this passage.
    case sendWord(reference: String)
    /// Chat with the composer filled in, never sent.
    case chat(prompt: String)
    case focusNearby
    case focusJournal
    case myChurch
    case website(URL)
}

enum ServeRules {
    static let maxEntryLength = 1000
    static let minLocationLength = 2
    static let maxLocationLength = 80

    static let prayPrompt = "I want to pray for someone by name today."
    static let nearbyFallbackPrompt = "Where could I help or give near me?"

    static func sendVersePrompt(_ reference: String) -> String {
        "Help me send someone \(reference) with a word of encouragement"
    }

    static func reachOutPrompt(_ title: String) -> String {
        "Help me write a kind message to \(title.lowercased())."
    }

    /// The button's destination, or nil when the way has no button here (no
    /// action, or "Give to your church" without a website to open).
    static func target(
        for way: ServeWay,
        nearbyAvailable: Bool,
        churchWebsite: String?
    ) -> ServeActionTarget? {
        let reference = way.verse.reference.trimmingCharacters(in: .whitespacesAndNewlines)
        switch way.action {
        case .shareVerse:
            return reference.isEmpty ? .chat(prompt: sendVersePrompt("a verse")) : .sendWord(reference: reference)
        case .pray:
            return .chat(prompt: prayPrompt)
        case .reachOut:
            return .chat(prompt: reachOutPrompt(way.title))
        case .nearby, .giveNeed:
            return nearbyAvailable ? .focusNearby : .chat(prompt: nearbyFallbackPrompt)
        case .church:
            return .myChurch
        case .giveChurch:
            return safeWebsite(churchWebsite).map(ServeActionTarget.website)
        case .journal:
            return .focusJournal
        case nil:
            return nil
        }
    }

    /// The button's words; the way's own title already says what it is.
    static func label(for action: ServeAction?, target: ServeActionTarget) -> String {
        switch action {
        case .shareVerse:
            if case .sendWord = target { return "Send a verse" }
            return "Help me send one"
        case .pray: return "Pray with SureWord"
        case .reachOut: return "Help me write it"
        case .nearby, .giveNeed:
            return target == .focusNearby ? "Find places near me" : "Ask SureWord"
        case .church: return "Open My church"
        case .giveChurch: return "Visit church website"
        case .journal: return "Write it down"
        case nil: return "Open"
        }
    }

    /// Only http(s) church sites open; anything else is ignored, as on the web.
    static func safeWebsite(_ raw: String?) -> URL? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty,
              let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.host?.isEmpty == false
        else { return nil }
        return url
    }

    /// Trimmed location, or nil when the route would refuse it.
    static func cleanLocation(_ raw: String) -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= minLocationLength, text.count <= maxLocationLength else { return nil }
        return text
    }

    /// Trimmed entry text, or nil when there is nothing the route would save.
    static func cleanEntry(_ raw: String) -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= maxEntryLength else { return nil }
        return text
    }

    private static let queryAllowed: CharacterSet = {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "+&=?#")
        return allowed
    }()

    static func nearbyPath(location: String, kind: String) -> String {
        let place = location.addingPercentEncoding(withAllowedCharacters: queryAllowed) ?? location
        let kindText = kind.addingPercentEncoding(withAllowedCharacters: queryAllowed) ?? kind
        return "/api/serve/nearby?location=\(place)&kind=\(kindText)"
    }

    static func entryPath(id: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return "/api/serve/journal/\(id.addingPercentEncoding(withAllowedCharacters: allowed) ?? id)"
    }

    /// Server timestamps carry milliseconds (`toISOString`); older rows or
    /// another writer might not, so both forms are read.
    static func entryDate(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: raw) { return date }
        return ISO8601DateFormatter().date(from: raw)
    }
}
