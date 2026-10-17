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

    @Test("A passage longer than a card shares as text, with no door that would 404")
    func longPassage() {
        #expect(ShareCards.verseCount("1 Corinthians 13:1-13") == 13)
        #expect(ShareCards.verseCount("John 3:16") == 1)
        #expect(ShareCards.verseCount("Psalms 23:1-4") == 4)
        #expect(!ShareCards.canDraw(.verse(reference: "1 Corinthians 13:1-13", translation: "KJV")))
        #expect(ShareCards.canDraw(.verse(reference: "Romans 8:31-40", translation: "KJV")))
        #expect(ShareCards.doorURL("1 Corinthians 13:1-13") == nil)
        #expect(ShareCards.textShare("Charity words", reference: "1 Corinthians 13:1-13") == "Charity words")
        #expect(ShareCards.textOnlyNotice(for: .verse(reference: "1 Corinthians 13:1-13", translation: "KJV")).hasPrefix("A card holds up to 10"))
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

    // MARK: Send a word

    @Test("Send to someone carries a drawable verse or the day's verse, never an answer")
    func sendWordReference() {
        #expect(ShareCards.sendWordReference(for: verse) == "Psalms 23:1-4")
        #expect(ShareCards.sendWordReference(for: .verse(reference: "John 3:16", translation: "BSB")) == "John 3:16")
        #expect(ShareCards.sendWordReference(for: cross) == "Isaiah 41:10")
        #expect(ShareCards.sendWordReference(for: answer) == nil)
        #expect(ShareCards.sendWordReference(for: .verse(reference: "John 1:1", translation: "LC Greek")) == nil)
        #expect(ShareCards.sendWordReference(for: .verse(reference: "1 Corinthians 13:1-13", translation: "KJV")) == nil)
        // Drawable as a card, but longer than the four verses a word card carries.
        #expect(ShareCards.sendWordReference(for: .verse(reference: "Romans 8:31-39", translation: "KJV")) == nil)
        #expect(ShareCards.sendWordReference(for: .cross(id: "x", reference: "Psalms 23:1-6")) == nil)
    }

    @Test("Asks for the owner's draft preview with the edit counter last")
    func personalPreviewPath() {
        #expect(
            ShareCards.personalPreviewPath(id: "abcDEF123ghi456J", style: .parchment, format: .square, size: .preview, edit: 3)
                == "/api/cards/personal/abcDEF123ghi456J/image?style=parchment&format=square&size=preview&t=3"
        )
        #expect(
            ShareCards.personalPreviewPath(id: "abcDEF123ghi456J", style: .dawn, format: .story, size: .full, edit: 0)
                == "/api/cards/personal/abcDEF123ghi456J/image?style=dawn&format=story&t=0"
        )
    }

    @Test("Fetches a sent card's public image in the server's order")
    func personalCardPath() {
        #expect(
            ShareCards.personalCardPath(id: "abcDEF123ghi456J", style: .sanctuary, format: .story, size: .full)
                == "/api/cards/c/abcDEF123ghi456J/image?style=sanctuary&format=story&v=\(ShareCards.designVersion)"
        )
        #expect(
            ShareCards.personalCardPath(id: "a/b", style: .dawn, format: .square, size: .preview)
                == "/api/cards/c/a%2Fb/image?style=dawn&format=square&size=preview&v=\(ShareCards.designVersion)"
        )
    }

    @Test("Introduces the sheet by whether a passage was chosen")
    func sendWordIntro() {
        #expect(ShareCards.sendWordIntro(reference: nil) == "SureWord will find a verse for them and write a word to go with it.")
        #expect(ShareCards.sendWordIntro(reference: "Isaiah 41:10") == "SureWord will write a word for them under Isaiah 41:10.")
    }

    @Test("Shares the link with who it is for")
    func sendWordLinkText() {
        #expect(
            ShareCards.sendWordLinkText(recipient: " Sarah ", url: "https://sureword.app/c/abc")
                == "A word for Sarah: https://sureword.app/c/abc"
        )
    }

    @Test("Names a sent card's file after its recipient, safely")
    func personalFileName() {
        #expect(ShareCards.personalFileName(recipient: "Sarah", style: .dawn, format: .story) == "SureWord for Sarah dawn story.jpg")
        #expect(ShareCards.personalFileName(recipient: "Mary-Jo O'Neil", style: .parchment, format: .square)
            == "SureWord for MaryJo ONeil parchment square.jpg")
        #expect(ShareCards.personalFileName(recipient: " ??? ", style: .sanctuary, format: .story) == "SureWord for you sanctuary story.jpg")
    }

    @Test("Keeps the inputs inside the server's limits")
    func sendWordLimits() {
        #expect(SendWordLimits.clip(String(repeating: "a", count: 45), to: SendWordLimits.recipient).count == 40)
        #expect(SendWordLimits.clip("Sarah", to: SendWordLimits.recipient) == "Sarah")
        #expect(SendWordLimits.canWrite(recipient: "Sarah", situation: "Surgery tomorrow"))
        #expect(!SendWordLimits.canWrite(recipient: "  ", situation: "Surgery tomorrow"))
        #expect(!SendWordLimits.canWrite(recipient: "Sarah", situation: "\n"))
    }

    @Test("Leaves the reference out of the draft request when SureWord picks the verse")
    func sendWordBody() throws {
        let found = try JSONEncoder().encode(SendWordRequest(recipient: "Sarah", situation: "Surgery", reference: nil))
        let foundObject = try #require(try JSONSerialization.jsonObject(with: found) as? [String: Any])
        #expect(foundObject.keys.sorted() == ["recipient", "situation"])
        let chosen = try JSONEncoder().encode(SendWordRequest(recipient: "Sarah", situation: "Surgery", reference: "Isaiah 41:10"))
        let chosenObject = try #require(try JSONSerialization.jsonObject(with: chosen) as? [String: Any])
        #expect(chosenObject["reference"] as? String == "Isaiah 41:10")

        let draft = try JSONDecoder().decode(
            SendWordDraft.self,
            from: Data(#"{"id":"abc","reference":"Isaiah 41:10","text":"Fear thou not","word":"Sarah, He is with you."}"#.utf8)
        )
        #expect(draft == SendWordDraft(id: "abc", reference: "Isaiah 41:10", text: "Fear thou not", word: "Sarah, He is with you."))
        #expect(try JSONDecoder().decode(SendWordDraft.self, from: Data("{}".utf8)).id.isEmpty)
        #expect(draft.fits, "an older server with no fits field reads as fitting")
        let tight = try JSONDecoder().decode(SendWordDraft.self, from: Data(#"{"id":"abc","fits":false}"#.utf8))
        #expect(!tight.fits)
        #expect(try !JSONDecoder().decode(PersonalCardSaved.self, from: Data(#"{"ok":true,"fits":false}"#.utf8)).fits)

        let another = try JSONEncoder().encode(SendWordRequest(recipient: "Sarah", situation: "Surgery", reference: nil, replaces: "old"))
        let anotherObject = try #require(try JSONSerialization.jsonObject(with: another) as? [String: Any])
        #expect(anotherObject["replaces"] as? String == "old")

        let publish = try JSONEncoder().encode(PublishPersonalCardRequest(draftId: "abc", personalLine: "Praying", signature: "Austin"))
        let publishObject = try #require(try JSONSerialization.jsonObject(with: publish) as? [String: Any])
        #expect(publishObject.keys.sorted() == ["draftId", "personalLine", "signature"])
    }

    @Test("Reads the sent cards leniently and titles them by recipient")
    func sentCards() throws {
        let json = #"""
        {"cards":[
          {"id":"a","url":"https://sureword.app/c/a","kind":"word","reference":"Isaiah 41:10","recipient":"Sarah","createdAt":"2026-10-17T10:00:00.000Z","revokedAt":null},
          {"id":"b","url":"https://sureword.app/c/b","kind":"verse","reference":"John 3:16","recipient":null,"createdAt":"2026-10-16T10:00:00.000Z","revokedAt":"2026-10-17T11:00:00.000Z"}
        ]}
        """#
        let cards = try JSONDecoder().decode(SentCardsResponse.self, from: Data(json.utf8)).cards
        #expect(cards.count == 2)
        #expect(cards[0].title == "For Sarah \u{00B7} Isaiah 41:10")
        #expect(!cards[0].isRevoked)
        #expect(cards[1].title == "John 3:16")
        #expect(cards[1].isRevoked)
        #expect(try JSONDecoder().decode(SentCardsResponse.self, from: Data(#"{"cards":"nope"}"#.utf8)).cards.isEmpty)
    }
}
