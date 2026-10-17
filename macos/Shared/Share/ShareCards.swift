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

    /// Mirrors `MAX_WORD_PASSAGE_VERSES` on the server: the most a "send a
    /// word" card carries (`tests/share-cards.test.mjs` pins the two).
    static let maxWordVerses = 4

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

    // MARK: Send a word

    /// The passage "Send to someone" carries from a Share sheet: a verse the
    /// server can draw, or the day's verse on Pick Up Your Cross, when it is
    /// at most `maxWordVerses` long, so the draft is never refused for its
    /// length. Only the reference travels, because drafts are KJV whatever the
    /// reader had open. Nil for an answer and for a longer passage, which hides
    /// the button. `sendWordReference` in the web and Android card module.
    static func sendWordReference(for target: ShareCardTarget) -> String? {
        let reference: String
        switch target {
        case .verse(let verse, _):
            guard canDraw(target) else { return nil }
            reference = verse
        case .cross(_, let verse):
            reference = verse
        case .answer:
            return nil
        }
        return verseCount(reference) <= maxWordVerses ? reference : nil
    }

    /// The owner-only preview of a draft (`GET /api/cards/personal/{id}/image`),
    /// sent with the session. `edit` counts the saved edits, so a new line of
    /// the sender's is a new URL and no cache ever shows the line as it was.
    static func personalPreviewPath(
        id: String,
        style: ShareCardStyle,
        format: ShareCardFormat,
        size: ShareCardSize,
        edit: Int
    ) -> String {
        var params: [(String, String)] = [("style", style.rawValue), ("format", format.rawValue)]
        if size == .preview { params.append(("size", "preview")) }
        params.append(("t", String(edit)))
        return "/api/cards/personal/\(pathSegment(id))/image?\(formQuery(params))"
    }

    /// The public image of a sent card (`GET /api/cards/c/{id}/image`), asked
    /// for with no session like every other public card.
    static func personalCardPath(id: String, style: ShareCardStyle, format: ShareCardFormat, size: ShareCardSize) -> String {
        var params: [(String, String)] = [("style", style.rawValue), ("format", format.rawValue)]
        if size == .preview { params.append(("size", "preview")) }
        params.append(("v", designVersion))
        return "/api/cards/c/\(pathSegment(id))/image?\(formQuery(params))"
    }

    /// The line above the fields before the draft exists.
    static func sendWordIntro(reference: String?) -> String {
        guard let reference else { return "SureWord will find a verse for them and write a word to go with it." }
        return "SureWord will write a word for them under \(reference)."
    }

    /// What Share link sends: who it is for, then the card's page.
    static func sendWordLinkText(recipient: String, url: String) -> String {
        "A word for \(recipient.trimmingCharacters(in: .whitespacesAndNewlines)): \(url)"
    }

    /// "SureWord for Sarah dawn story.jpg". Anything but ASCII letters, digits
    /// and spaces is dropped (not replaced, as Android's file name drops it),
    /// and a name with nothing left reads "you".
    static func personalFileName(recipient: String, style: ShareCardStyle, format: ShareCardFormat) -> String {
        var safe = ""
        for scalar in recipient.unicodeScalars {
            if isLowerAlphanumeric(scalar) || (65...90).contains(scalar.value) || scalar == " " {
                safe.unicodeScalars.append(scalar)
            }
        }
        let name = safe.trimmingCharacters(in: .whitespaces)
        return "SureWord for \(name.isEmpty ? "you" : name) \(style.rawValue) \(format.rawValue).jpg"
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
    static func pathSegment(_ value: String) -> String {
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

/// The Send a word inputs, with the server's limits. A SwiftUI text field has
/// no `maxLength`, so the sheet clips through `clip` as the person types, and
/// the server refuses (400) anything longer either way.
enum SendWordLimits {
    static let recipient = 40
    static let situation = 300
    static let personalLine = 120
    static let signature = 30

    static func clip(_ value: String, to limit: Int) -> String {
        value.count > limit ? String(value.prefix(limit)) : value
    }

    /// Both a name and what they face, or there is nothing to choose a verse by.
    static func canWrite(recipient: String, situation: String) -> Bool {
        !recipient.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !situation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Body of `POST /api/cards/word`. `reference` is left out entirely when
/// SureWord is to find the passage, which the synthesized encoder does for a
/// nil optional. `situation` is sent once and never stored by the server.
struct SendWordRequest: Sendable, Equatable, Encodable {
    var recipient: String
    var situation: String
    var reference: String?
    /// "Write another word": the unsent draft this one replaces, which the
    /// server deletes. Left out for the first draft.
    var replaces: String? = nil
}

/// Response of `POST /api/cards/word`: an unpublished draft. Decoded leniently
/// so a missing field reads as empty rather than throwing away the draft; the
/// sheet treats an empty id as a failure.
struct SendWordDraft: Sendable, Equatable, Decodable {
    var id: String
    var reference: String
    var text: String
    var word: String
    /// Whether the card draws whole at every size. Share waits for true,
    /// because publishing refuses (422) a card that would cut anything off.
    var fits: Bool

    init(id: String, reference: String, text: String, word: String, fits: Bool = true) {
        self.id = id
        self.reference = reference
        self.text = text
        self.word = word
        self.fits = fits
    }

    private enum CodingKeys: String, CodingKey { case id, reference, text, word, fits }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? ""
        reference = (try? container.decode(String.self, forKey: .reference)) ?? ""
        text = (try? container.decode(String.self, forKey: .text)) ?? ""
        word = (try? container.decode(String.self, forKey: .word)) ?? ""
        fits = (try? container.decode(Bool.self, forKey: .fits)) ?? true
    }
}

/// Response of `PATCH /api/cards/personal/{id}`: whether the card, with the
/// sender's words as just saved, still draws whole at every size.
struct PersonalCardSaved: Sendable, Equatable, Decodable {
    var fits: Bool

    init(fits: Bool) {
        self.fits = fits
    }

    private enum CodingKeys: String, CodingKey { case fits }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        fits = (try? container.decode(Bool.self, forKey: .fits)) ?? true
    }
}

/// Body of `PATCH /api/cards/personal/{id}`: the sender's own line and name.
struct PersonalCardEdit: Sendable, Equatable, Encodable {
    var personalLine: String
    var signature: String
}

/// Body of `POST /api/cards/personal` when publishing a draft.
struct PublishPersonalCardRequest: Sendable, Equatable, Encodable {
    var draftId: String
    var personalLine: String
    var signature: String
}

/// Response of `POST /api/cards/personal`: the sent card and its public page.
struct PublishedPersonalCard: Sendable, Equatable, Decodable {
    var id: String
    var url: String

    private enum CodingKeys: String, CodingKey { case id, url }

    init(id: String, url: String) {
        self.id = id
        self.url = url
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? ""
        url = (try? container.decode(String.self, forKey: .url)) ?? ""
    }
}

/// One row of `GET /api/cards/personal`, for Settings -> Cards you sent.
/// Lenient for the same reason as `SharedAnswerRow`: one odd row must not
/// empty the list.
struct SentCardRow: Sendable, Equatable, Decodable, Identifiable {
    var id: String
    var url: String
    /// "word" for a Send a word card, "verse" for a personal verse card.
    var kind: String
    var reference: String
    var recipient: String?
    var createdAt: String?
    /// `var` so the optimistic revoke can stamp it.
    var revokedAt: String?

    var isRevoked: Bool { revokedAt != nil }

    /// "For Sarah · Isaiah 41:10", or the reference alone when the card names
    /// nobody. The middle dot is Android's and the web's separator.
    var title: String {
        guard let recipient = recipient?.trimmingCharacters(in: .whitespacesAndNewlines), !recipient.isEmpty else {
            return reference
        }
        return "For \(recipient) \u{00B7} \(reference)"
    }

    init(
        id: String,
        url: String,
        kind: String = "word",
        reference: String,
        recipient: String? = nil,
        createdAt: String? = nil,
        revokedAt: String? = nil
    ) {
        self.id = id
        self.url = url
        self.kind = kind
        self.reference = reference
        self.recipient = recipient
        self.createdAt = createdAt
        self.revokedAt = revokedAt
    }

    private enum CodingKeys: String, CodingKey { case id, url, kind, reference, recipient, createdAt, revokedAt }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? ""
        url = (try? container.decode(String.self, forKey: .url)) ?? ""
        kind = (try? container.decode(String.self, forKey: .kind)) ?? "word"
        reference = (try? container.decode(String.self, forKey: .reference)) ?? ""
        recipient = try? container.decode(String.self, forKey: .recipient)
        createdAt = try? container.decode(String.self, forKey: .createdAt)
        revokedAt = try? container.decode(String.self, forKey: .revokedAt)
    }
}

/// Envelope of `GET /api/cards/personal`.
struct SentCardsResponse: Sendable, Equatable, Decodable {
    var cards: [SentCardRow]

    private enum CodingKeys: String, CodingKey { case cards }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        cards = (try? container.decode([SentCardRow].self, forKey: .cards)) ?? []
    }
}
