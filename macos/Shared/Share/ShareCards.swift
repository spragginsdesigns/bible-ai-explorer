import Foundation

/// Share cards on the Apple clients: the pure half (`docs/FEATURES.md`, "Share
/// cards"). A line-for-line port of `mobile/src/features/shareCards/shareCards.ts`
/// (Android) and `src/lib/share-cards/targets.ts` (web); `ShareCardsTests` pins
/// the same cases as `shareCards.test.ts`.
///
/// The server draws every card (`src/lib/share-cards/render.tsx`), so this file
/// only decides WHICH card a share means and where to fetch it. Two rules matter
/// most: a card URL never carries the words themselves (the verse route looks
/// Scripture up by reference), and the personal cross card always goes out with
/// the session.

enum ShareCardStyle: String, CaseIterable, Sendable, Identifiable {
    case dawn, parchment, sanctuary

    var id: String { rawValue }

    var label: String {
        switch self {
        case .dawn: "Dawn"
        case .parchment: "Parchment"
        case .sanctuary: "Sanctuary"
        }
    }

    /// The two colours the chip's swatch blends between: the glow, then the
    /// ground. The same pairs Android and web draw.
    var swatch: (glow: UInt32, ground: UInt32) {
        switch self {
        case .dawn: (0xF2B55C, 0x1B1A14)
        case .parchment: (0xE7CF98, 0xB98A45)
        case .sanctuary: (0x3A3226, 0x0D0C0A)
        }
    }
}

enum ShareCardFormat: String, CaseIterable, Sendable, Identifiable {
    case story, square

    var id: String { rawValue }

    var label: String {
        switch self {
        case .story: "Story"
        case .square: "Square"
        }
    }

    /// Width over height, so the preview holds its shape before the image lands.
    var aspectRatio: Double {
        switch self {
        case .story: 1080.0 / 1920.0
        case .square: 1
        }
    }
}

/// What a Share sheet is sharing.
enum ShareCardTarget: Sendable, Equatable, Hashable {
    /// "John 3:16", or a range within one chapter ("Psalms 23:1-4"), with the
    /// translation label on screen: an id, or the reader's "LC Greek" (no card
    /// for that).
    case verse(reference: String, translation: String)
    /// One Pick Up Your Cross day, by its `VerseOfDay` row id.
    case cross(id: String, reference: String)
    /// One settled answer. Its card is drawn from the public snapshot, so the
    /// link is minted before there is anything to fetch.
    case answer(conversationID: String, messageID: String)

    /// The analytics `kind`, Android's `target.kind`.
    var kind: String {
        switch self {
        case .verse: "verse"
        case .cross: "cross"
        case .answer: "answer"
        }
    }

    /// The reference a verse or cross card prints, nil for an answer.
    var reference: String? {
        switch self {
        case .verse(let reference, _), .cross(_, let reference): reference
        case .answer: nil
        }
    }
}

enum ShareCardSize: Sendable {
    case full
    case preview
}

/// One card to fetch.
struct ShareCardRequest: Sendable, Equatable {
    var style: ShareCardStyle
    var format: ShareCardFormat
    var size: ShareCardSize
    /// Draw the verse's encouragement line. Only after POST
    /// `/api/cards/encouragement` has written it; the card route refuses (409)
    /// a note it does not have.
    var note = false
    /// The device's IANA zone, so the cross card's date is the reader's day.
    var timeZone: String? = nil
}

enum ShareCards {
    /// Must match `SHARE_CARD_DESIGN_VERSION` on the server: it keys the CDN copy.
    static let designVersion = "2"

    static let defaultStyle: ShareCardStyle = .dawn
    static let defaultFormat: ShareCardFormat = .story

    /// Mirrors `MAX_CARD_VERSES` on the server: the reader's selection limit.
    static let maxCardVerses = 10

    /// Shown in place of the card controls when this share cannot be a picture.
    static func textOnlyNotice(for target: ShareCardTarget) -> String {
        if case .verse(_, let translation) = target, cardTranslation(translation) != nil {
            return "A card holds up to \(maxCardVerses) verses. This passage shares as text."
        }
        return "Cards are drawn in the KJV, BSB and NKJV. This passage shares as text."
    }

    /// How many verses "John 3:16-18" spans: 3. A single verse, or a reference
    /// this cannot read, counts as 1, and the server stays the judge of those.
    static func verseCount(_ reference: String) -> Int {
        let trimmed = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let colon = trimmed.lastIndex(of: ":") else { return 1 }
        let tail = trimmed[trimmed.index(after: colon)...]
        let parts = tail.split(separator: "-").map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count == 2, let start = Int(parts[0]), let end = Int(parts[1]), end >= start else { return 1 }
        return end - start + 1
    }

    /// The translations the server can look up and draw, by their wire id.
    static func cardTranslation(_ label: String) -> String? {
        let upper = label.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return ["KJV", "BSB", "NKJV"].contains(upper) ? upper : nil
    }

    /// Whether this share can be a picture. A verse in a translation the server
    /// cannot draw (the LC Greek), or a chat passage longer than a card holds
    /// (1 Corinthians 13:1-13), shares as text only, rather than as a card that
    /// would silently swap in the KJV or an error that never clears.
    static func canDraw(_ target: ShareCardTarget) -> Bool {
        if case .verse(let reference, let translation) = target {
            return cardTranslation(translation) != nil && verseCount(reference) <= maxCardVerses
        }
        return true
    }

    /// The personal card needs the session; verse and answer cards are public.
    static func needsSession(_ target: ShareCardTarget) -> Bool {
        if case .cross = target { return true }
        return false
    }

    /// The path (on `Config.apiURL`) of one card, or nil when this share cannot
    /// be a picture yet: a verse the server cannot draw, or an answer whose
    /// public link has not been minted (`sharedAnswerID`).
    ///
    /// Each query is built in the server's canonical order with
    /// `URLSearchParams` spelling, because the verse route redirects any other
    /// spelling and a redirect costs the preview a round trip.
    static func path(
        for target: ShareCardTarget,
        _ request: ShareCardRequest,
        sharedAnswerID: String? = nil
    ) -> String? {
        var params: [(String, String)] = [("style", request.style.rawValue), ("format", request.format.rawValue)]
        if request.size == .preview { params.append(("size", "preview")) }

        switch target {
        case .verse(let reference, let label):
            guard let translation = cardTranslation(label) else { return nil }
            var query: [(String, String)] = [
                ("ref", reference),
                ("translation", translation),
                ("style", request.style.rawValue),
                ("format", request.format.rawValue),
            ]
            if request.note { query.append(("note", "1")) }
            if request.size == .preview { query.append(("size", "preview")) }
            query.append(("v", designVersion))
            return "/api/cards/verse?\(formQuery(query))"
        case .cross(let id, _):
            if let timeZone = request.timeZone { params.append(("tz", timeZone)) }
            params.append(("v", designVersion))
            return "/api/cards/cross/\(pathSegment(id))?\(formQuery(params))"
        case .answer:
            guard let sharedAnswerID, !sharedAnswerID.isEmpty else { return nil }
            params.append(("v", designVersion))
            return "/api/shared/\(pathSegment(sharedAnswerID))/image?\(formQuery(params))"
        }
    }

    /// "John 3:16-17" to "john-3-16-17", the public page every verse and cross
    /// card prints. Must match `verseSlug` in `src/lib/share-cards/layout.ts`.
    static func slug(_ reference: String) -> String {
        var slug = ""
        var pendingDash = false
        for scalar in reference.lowercased().unicodeScalars {
            if isLowerAlphanumeric(scalar) {
                if pendingDash, !slug.isEmpty { slug.append("-") }
                pendingDash = false
                slug.unicodeScalars.append(scalar)
            } else {
                pendingDash = true
            }
        }
        return slug
    }

    /// The door as a link, for text shares: the page the card itself prints.
    /// Nil for a passage longer than a card, which has no page.
    static func doorURL(_ reference: String) -> String? {
        guard verseCount(reference) <= maxCardVerses else { return nil }
        return "https://sureword.app/v/\(slug(reference))"
    }

    /// A verse or cross share as text: the words, the encouragement line when
    /// one is on the card, then the door, so a text share brings people in too.
    static func textShare(_ text: String, reference: String, note: String? = nil) -> String {
        let line = note.map { "\n\n\($0)" } ?? ""
        let door = doorURL(reference).map { "\n\n\($0)" } ?? ""
        return "\(text)\(line)\(door)"
    }

    /// A Pick Up Your Cross day as text: the verse, then the question to carry
    /// when the day has one. Never "why today": that names the reader's own
    /// week, and a share is handed to other people.
    static func crossShareText(reference: String, text: String, question: String?) -> String {
        let verse = VerseAttachment.formatForSharing(reference: reference, text: text, translation: .kjv)
        guard let question = question?.trimmingCharacters(in: .whitespacesAndNewlines), !question.isEmpty else {
            return verse
        }
        return "\(verse)\n\nCarry this: \(question)"
    }

    /// "SureWord John 3-16 dawn story.jpg": what the receiving app shows as the
    /// file name.
    static func fileName(_ target: ShareCardTarget, style: ShareCardStyle, format: ShareCardFormat) -> String {
        let label: String
        switch target {
        case .answer: label = "Answer"
        case .cross(_, let reference): label = "Cross \(reference)"
        case .verse(let reference, _): label = reference
        }
        var safe = ""
        var pendingDash = false
        for scalar in label.unicodeScalars {
            let isWord = isLowerAlphanumeric(scalar) || (65...90).contains(scalar.value) || scalar == " "
            if isWord {
                if pendingDash { safe.append("-") }
                pendingDash = false
                safe.unicodeScalars.append(scalar)
            } else {
                pendingDash = true
            }
        }
        if pendingDash { safe.append("-") }
        let collapsed = safe.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return "SureWord \(collapsed) \(style.rawValue) \(format.rawValue).jpg"
    }

    // MARK: Encoding

    /// ASCII `a-z` or `0-9` only, as the JS character classes read: a
    /// lowercased accented letter is not in `[a-z]` there either.
    private static func isLowerAlphanumeric(_ scalar: Unicode.Scalar) -> Bool {
        (97...122).contains(scalar.value) || (48...57).contains(scalar.value)
    }

    /// `application/x-www-form-urlencoded`, exactly as `URLSearchParams.toString`
    /// writes it: only `A-Z a-z 0-9 * - . _` survive, a space is "+", and
    /// everything else is percent-encoded as UTF-8.
    static func formEncode(_ value: String) -> String {
        var encoded = ""
        for byte in value.utf8 {
            switch byte {
            case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"),
                 UInt8(ascii: "0")...UInt8(ascii: "9"),
                 UInt8(ascii: "*"), UInt8(ascii: "-"), UInt8(ascii: "."), UInt8(ascii: "_"):
                encoded.unicodeScalars.append(UnicodeScalar(byte))
            case UInt8(ascii: " "):
                encoded.append("+")
            default:
                encoded += String(format: "%%%02X", byte)
            }
        }
        return encoded
    }

    private static func formQuery(_ pairs: [(String, String)]) -> String {
        pairs.map { "\(formEncode($0.0))=\(formEncode($0.1))" }.joined(separator: "&")
    }

    /// `encodeURIComponent` for one path segment. Server-minted ids are
    /// URL-safe already; escaping them anyway is the habit that keeps a path
    /// from ever being built out of raw data.
    private static func pathSegment(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.!~*'()")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}

/// The last style, size and encouragement choice, per device: people tend to
/// have a favourite. Stored as Android's JSON under the same key.
struct ShareCardPrefs: Sendable, Equatable {
    static let storageKey = "sureword.shareCard.v1"

    var style: ShareCardStyle = ShareCards.defaultStyle
    var format: ShareCardFormat = ShareCards.defaultFormat
    /// Add the verse's line of encouragement. On unless the reader turned it off.
    var encourage = true

    /// Anything unreadable is just the default, field by field.
    static func parse(_ raw: String?) -> ShareCardPrefs {
        var prefs = ShareCardPrefs()
        guard let data = raw?.data(using: .utf8),
              let stored = try? JSONDecoder().decode(Stored.self, from: data)
        else { return prefs }
        if let style = stored.style.flatMap(ShareCardStyle.init(rawValue:)) { prefs.style = style }
        if let format = stored.format.flatMap(ShareCardFormat.init(rawValue:)) { prefs.format = format }
        // Only an explicit false turns it off, as Android's `=== false`: a
        // missing or odd value (a 0, a string) keeps it on.
        if stored.encourage == false { prefs.encourage = false }
        return prefs
    }

    /// The stored JSON, each field read on its own so one odd value cannot
    /// discard the others. `JSONDecoder` refuses a number for a Bool, which is
    /// what keeps a stray 0 from reading as "off".
    private struct Stored: Decodable {
        var style: String?
        var format: String?
        var encourage: Bool?

        private enum CodingKeys: String, CodingKey { case style, format, encourage }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            style = try? container.decode(String.self, forKey: .style)
            format = try? container.decode(String.self, forKey: .format)
            encourage = try? container.decode(Bool.self, forKey: .encourage)
        }
    }

    var encoded: String {
        "{\"style\":\"\(style.rawValue)\",\"format\":\"\(format.rawValue)\",\"encourage\":\(encourage)}"
    }

    static func load(_ defaults: UserDefaults = .standard) -> ShareCardPrefs {
        parse(defaults.string(forKey: storageKey))
    }

    func save(_ defaults: UserDefaults = .standard) {
        defaults.set(encoded, forKey: Self.storageKey)
    }
}

// MARK: - Wire types

/// Body of `POST /api/cards/encouragement`.
struct EncouragementRequest: Sendable, Equatable, Encodable {
    var ref: String
}

/// Response of `POST /api/cards/encouragement`: the server's own spelling of
/// the reference, which the card URL must use, and the one sentence it wrote.
struct EncouragementResponse: Sendable, Equatable, Decodable {
    var reference: String
    var text: String
}
