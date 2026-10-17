import Foundation
import Testing
@testable import SureWord

/// Ported case for case from `mobile/src/features/shareCards/shareCards.test.ts`,
/// which pins Android's and the web's copy of the same rules. If a case here
/// changes, that suite must change with it. Compiled into both the macOS and
/// iOS test targets.
@Suite("Share cards")
struct ShareCardsTests {
    private let verse = ShareCardTarget.verse(reference: "Psalms 23:1-4", translation: "KJV")
    private let cross = ShareCardTarget.cross(id: "cmabc123def456ghi789", reference: "Isaiah 41:10")
    private let answer = ShareCardTarget.answer(conversationID: "c1", messageID: "m1")

    private func query(_ path: String?) throws -> [String: String] {
        let path = try #require(path)
        let components = try #require(URLComponents(string: "https://sureword.app\(path)"))
        var values: [String: String] = [:]
        for item in components.percentEncodedQueryItems ?? [] {
            let raw = (item.value ?? "").replacingOccurrences(of: "+", with: " ")
            values[item.name] = raw.removingPercentEncoding ?? raw
        }
        return values
    }

    // MARK: Paths

    @Test("Asks the public verse route by reference, never by text")
    func versePathByReference() throws {
        let path = ShareCards.path(for: verse, ShareCardRequest(style: .parchment, format: .square, size: .preview))
        #expect(path?.hasPrefix("/api/cards/verse?") == true)
        let params = try query(path)
        #expect(params["ref"] == "Psalms 23:1-4")
        #expect(params["translation"] == "KJV")
        #expect(params["style"] == "parchment")
        #expect(params["format"] == "square")
        #expect(params["size"] == "preview")
        #expect(params["v"] == ShareCards.designVersion)
        #expect(params["text"] == nil)
    }

    @Test("Builds the server's canonical query, note included, so a card never costs a redirect")
    func canonicalVerseQuery() {
        let path = ShareCards.path(for: verse, ShareCardRequest(style: .dawn, format: .story, size: .preview, note: true))
        #expect(path == "/api/cards/verse?ref=Psalms+23%3A1-4&translation=KJV&style=dawn&format=story&note=1&size=preview&v=\(ShareCards.designVersion)")
    }

    @Test("Omits size for the full card, which is what gets shared")
    func fullCardHasNoSize() throws {
        let params = try query(ShareCards.path(for: verse, ShareCardRequest(style: .dawn, format: .story, size: .full)))
        #expect(params["size"] == nil)
    }

    @Test("Sends the device zone with the personal cross card, in the server's order")
    func crossCarriesZone() throws {
        let path = ShareCards.path(
            for: cross,
            ShareCardRequest(style: .dawn, format: .story, size: .full, timeZone: "America/Chicago")
        )
        #expect(path?.hasPrefix("/api/cards/cross/cmabc123def456ghi789?") == true)
        #expect(try query(path)["tz"] == "America/Chicago")
        #expect(path == "/api/cards/cross/cmabc123def456ghi789?style=dawn&format=story&tz=America%2FChicago&v=\(ShareCards.designVersion)")
    }

    @Test("Has no answer card until its public link exists")
    func answerNeedsLink() {
        #expect(ShareCards.path(for: answer, ShareCardRequest(style: .dawn, format: .story, size: .full)) == nil)
        let path = ShareCards.path(
            for: answer,
            ShareCardRequest(style: .sanctuary, format: .story, size: .full),
            sharedAnswerID: "abcDEF123ghi456J"
        )
        #expect(path?.hasPrefix("/api/shared/abcDEF123ghi456J/image?") == true)
    }

    @Test("Draws only the translations the server can look up")
    func drawableTranslations() {
        #expect(ShareCards.cardTranslation("nkjv") == "NKJV")
        #expect(ShareCards.cardTranslation("LC Greek") == nil)
        #expect(!ShareCards.canDraw(.verse(reference: "John 1:1", translation: "LC Greek")))
        #expect(!ShareCards.canDraw(.verse(reference: "John 1:1", translation: "")))
        #expect(ShareCards.path(
            for: .verse(reference: "John 1:1", translation: "LC Greek"),
            ShareCardRequest(style: .dawn, format: .story, size: .full)
        ) == nil)
        #expect(ShareCards.canDraw(cross))
        #expect(ShareCards.canDraw(answer))
    }

    @Test("Sends the session only for the personal card")
    func sessionOnlyForCross() {
        #expect(ShareCards.needsSession(cross))
        #expect(!ShareCards.needsSession(verse))
        #expect(!ShareCards.needsSession(answer))
    }

    @Test("Encodes a query exactly as URLSearchParams does")
    func formEncoding() {
        #expect(ShareCards.formEncode("Song of Solomon 2:1-3") == "Song+of+Solomon+2%3A1-3")
        #expect(ShareCards.formEncode("a*b.c_d~e'f") == "a*b.c_d%7Ee%27f")
        #expect(ShareCards.formEncode("é") == "%C3%A9")
    }

    // MARK: Details

    @Test("Points the door at the passage's public page")
    func door() {
        #expect(ShareCards.slug("1 John 1:9") == "1-john-1-9")
        #expect(ShareCards.slug("Song of Solomon 2:1-3") == "song-of-solomon-2-1-3")
        #expect(ShareCards.slug("  --Psalms 23:1--  ") == "psalms-23-1")
        #expect(ShareCards.doorURL("Psalms 23:1-4") == "https://sureword.app/v/psalms-23-1-4")
    }

    @Test("A text share carries the encouragement line, then the door")
    func textShare() {
        #expect(ShareCards.textShare("John 3:16 words", reference: "John 3:16") == "John 3:16 words\n\nhttps://sureword.app/v/john-3-16")
        #expect(
            ShareCards.textShare("John 3:16 words", reference: "John 3:16", note: "He loves you.")
                == "John 3:16 words\n\nHe loves you.\n\nhttps://sureword.app/v/john-3-16"
        )
    }

    @Test("The cross shares its question to carry, never why today")
    func crossText() {
        let text = ShareCards.crossShareText(reference: "Isaiah 41:10", text: "Fear thou not", question: "What fear will you hand Him?")
        #expect(text.hasSuffix("\n\nCarry this: What fear will you hand Him?"))
        #expect(text.hasPrefix("Isaiah 41:10"))
        #expect(!ShareCards.crossShareText(reference: "Isaiah 41:10", text: "Fear thou not", question: "  ").contains("Carry this"))
    }

    @Test("Names the file after what it shows, safely")
    func fileName() {
        #expect(ShareCards.fileName(verse, style: .dawn, format: .story) == "SureWord Psalms 23-1-4 dawn story.jpg")
        #expect(ShareCards.fileName(answer, style: .parchment, format: .square) == "SureWord Answer parchment square.jpg")
        #expect(ShareCards.fileName(cross, style: .sanctuary, format: .story) == "SureWord Cross Isaiah 41-10 sanctuary story.jpg")
    }

    @Test("Remembers a valid style and size, and ignores anything else")
    func prefs() {
        #expect(ShareCardPrefs.parse(#"{"style":"sanctuary","format":"square"}"#)
            == ShareCardPrefs(style: .sanctuary, format: .square, encourage: true))
        #expect(ShareCardPrefs.parse(#"{"style":"neon","format":"wide"}"#)
            == ShareCardPrefs(style: .dawn, format: .story, encourage: true))
        #expect(ShareCardPrefs.parse("{not json") == ShareCardPrefs())
        #expect(ShareCardPrefs.parse(nil) == ShareCardPrefs())
        #expect(ShareCardPrefs.parse(#"{"encourage":false}"#).encourage == false)
        #expect(ShareCardPrefs.parse(#"{"encourage":0}"#).encourage == true)
    }

    @Test("Stores the choice as Android's JSON, which reads back the same")
    func prefsRoundTrip() throws {
        let prefs = ShareCardPrefs(style: .parchment, format: .square, encourage: false)
        #expect(ShareCardPrefs.parse(prefs.encoded) == prefs)
        let object = try #require(
            try JSONSerialization.jsonObject(with: Data(prefs.encoded.utf8)) as? [String: Any]
        )
        #expect(object["style"] as? String == "parchment")
        #expect(object["format"] as? String == "square")
        #expect(object["encourage"] as? Bool == false)
    }

    @Test("The encouragement request carries only the reference")
    func encouragementBody() throws {
        let data = try JSONEncoder().encode(EncouragementRequest(ref: "John 3:16"))
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object.keys.sorted() == ["ref"])
        let response = try JSONDecoder().decode(
            EncouragementResponse.self,
            from: Data(#"{"reference":"John 3:16","text":"He gave His Son for you."}"#.utf8)
        )
        #expect(response.reference == "John 3:16")
    }
}
