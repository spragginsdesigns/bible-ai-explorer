import Foundation
import XCTest

@testable import SureWord

/// Spanish and German (docs/languages/PLAN.md, "Implementation contract"): the
/// two bundled Bibles, their book names in the reference resolver and the chat
/// citation matcher, the effective answer language, and the requests that
/// carry it. Pure `Shared/` logic, so the macOS suite runs this file too.
final class LanguagesTests: XCTestCase {
    // MARK: - Translations

    func testTheNewBiblesCarryTheirLanguageAndNames() {
        XCTAssertEqual(TranslationID.allCases, [.kjv, .nkjv, .bsb, .asv, .rv1909, .lut1912])
        XCTAssertEqual(TranslationID(rawValue: "ASV"), .asv)
        XCTAssertEqual(TranslationID.asv.name, "American Standard Version")
        XCTAssertEqual(TranslationID.asv.copyright, "Public domain")
        XCTAssertEqual(TranslationID.asv.language, .en)
        XCTAssertEqual(TranslationID.asv.pickerLabel, "ASV")
        XCTAssertFalse(TranslationID.asv.hasSectionHeadings)
        XCTAssertEqual(TranslationID(rawValue: "RV1909"), .rv1909)
        XCTAssertEqual(TranslationID(rawValue: "LUT1912"), .lut1912)
        XCTAssertEqual(TranslationID.rv1909.name, "Reina-Valera 1909")
        XCTAssertEqual(TranslationID.lut1912.name, "Lutherbibel 1912")
        XCTAssertEqual(TranslationID.rv1909.copyright, "Public domain")
        XCTAssertEqual(TranslationID.lut1912.copyright, "Public domain")
        XCTAssertEqual(TranslationID.rv1909.language, .es)
        XCTAssertEqual(TranslationID.lut1912.language, .de)
        XCTAssertEqual([TranslationID.kjv, .nkjv, .bsb].map(\.language), [.en, .en, .en])
        XCTAssertEqual(TranslationID.rv1909.pickerLabel, "Reina-Valera 1909 \u{00B7} Espa\u{00F1}ol")
        XCTAssertEqual(TranslationID.lut1912.pickerLabel, "Lutherbibel 1912 \u{00B7} Deutsch")
        XCTAssertEqual(TranslationID.kjv.pickerLabel, "KJV")
        // KJV-only and BSB-sourced extras do not apply to the new Bibles.
        XCTAssertFalse(TranslationID.rv1909.hasSectionHeadings)
        XCTAssertFalse(TranslationID.lut1912.hasSectionHeadings)
        XCTAssertTrue(TranslationID.kjv.hasSectionHeadings)
    }

    func testJohn316LoadsFromTheBundledSpanishAndGermanBibles() async throws {
        let spanish = try await BibleTranslations.chapter(.rv1909, order: 43, chapter: 3)
        XCTAssertTrue(spanish[15].hasPrefix("Porque de tal manera am\u{00F3} Dios al mundo"), spanish[15])

        let german = try await BibleTranslations.chapter(.lut1912, order: 43, chapter: 3)
        XCTAssertTrue(german[15].hasPrefix("Also hat Gott die Welt geliebt"), german[15])

        // Every chapter of a book is there, in the KJV's numbering.
        let psalms = try await BibleTranslations.chapter(.lut1912, order: 19, chapter: 150)
        XCTAssertEqual(psalms.count, 6)
    }

    func testTheASVLeavesTheVersesItOmitsEmptyInTheKJVSlots() async throws {
        // LC-17800: the ASV fills the KJV's slots except the 16 it omits.
        let genesis = try await BundledBible.asv.chapter(order: 1, chapter: 1)
        XCTAssertEqual(genesis.first, "In the beginning God created the heavens and the earth.")
        let matthew = try await BundledBible.asv.chapter(order: 40, chapter: 17)
        XCTAssertEqual(matthew.count, 27)
        XCTAssertEqual(matthew[20], "", "Matthew 17:21")
        XCTAssertTrue(matthew[21].hasPrefix("And while they abode in Galilee"), matthew[21])
        let hits = try await BundledBible.asv.search("jairus", limit: 3)
        XCTAssertEqual(hits.first.map { "\($0.order) \($0.chapter):\($0.verse)" }, "41 5:22", "accent folding finds Ja\u{00EF}rus")
    }

    func testASVReaderDispatchAndFormattingKeepMarkOmissionsInTheirNumberedSlots() async throws {
        let mark = try await BibleTranslations.chapter(.asv, order: 41, chapter: 9)
        XCTAssertEqual(mark.count, 50)
        XCTAssertEqual(mark[43], "", "Mark 9:44 is omitted")
        XCTAssertEqual(mark[45], "", "Mark 9:46 is omitted")
        let formatted = await ReaderAnnotations.shared.chapter(.asv, order: 41, chapter: 9, markups: mark)
        XCTAssertEqual(formatted.filter(\.omitted).map(\.number), [44, 46])
        XCTAssertEqual(formatted[44].number, 45)
        XCTAssertEqual(formatted[44].plainText, mark[44])
        XCTAssertFalse(formatted[44].omitted)
        XCTAssertTrue(formatted.allSatisfy { $0.headings.isEmpty }, "ASV must not inherit KJV/BSB editorial headings")
    }

    func testAnUnknownChapterIsTheReaderError() async {
        do {
            _ = try await BibleTranslations.chapter(.rv1909, order: 43, chapter: 22)
            XCTFail("John 22 does not exist")
        } catch {
            XCTAssertEqual((error as? BibleError)?.message, BibleTranslations.chapterLoadError)
        }
    }

    func testSearchFindsAccentedWordsWithoutTheAccents() async throws {
        // Nine verses use the word and John 3:16 is the sixth, so leave room.
        let hits = try await BundledBible.rv1909.search("unigenito", limit: 100)
        XCTAssertEqual(hits.count, 9)
        XCTAssertTrue(hits.contains { $0.order == 43 && $0.chapter == 3 && $0.verse == 16 })
        XCTAssertTrue(hits.allSatisfy { $0.text.contains("unig\u{00E9}nito") })
    }

    // MARK: - Book names

    func testSpanishAndGermanReferencesResolve() {
        XCTAssertEqual(Bible.resolveReference("Juan 3:16"), Reference(order: 43, chapter: 3, verse: 16))
        XCTAssertEqual(Bible.resolveReference("1. Johannes 1:9"), Reference(order: 62, chapter: 1, verse: 9))
        XCTAssertEqual(Bible.resolveReference("1 Johannes 1:9"), Reference(order: 62, chapter: 1, verse: 9))
        XCTAssertEqual(Bible.resolveReference("G\u{00E9}nesis 1:1"), Reference(order: 1, chapter: 1, verse: 1))
        XCTAssertEqual(Bible.resolveReference("Genesis 1:1"), Reference(order: 1, chapter: 1, verse: 1))
        XCTAssertEqual(Bible.resolveReference("R\u{00F6}mer 8:28"), Reference(order: 45, chapter: 8, verse: 28))
        XCTAssertEqual(Bible.resolveReference("Romer 8:28"), Reference(order: 45, chapter: 8, verse: 28))
        XCTAssertEqual(Bible.resolveReference("1. Mose 1:1"), Reference(order: 1, chapter: 1, verse: 1))
        XCTAssertEqual(Bible.resolveReference("Salmo 23"), Reference(order: 19, chapter: 23, verse: nil))
        XCTAssertEqual(Bible.resolveReference("Hechos de los Ap\u{00F3}stoles 2:38"), Reference(order: 44, chapter: 2, verse: 38))
        XCTAssertEqual(Bible.resolveReference("Offenbarung 22:21"), Reference(order: 66, chapter: 22, verse: 21))
        XCTAssertEqual(Bible.resolveReference("Apocalipsis 22:21"), Reference(order: 66, chapter: 22, verse: 21))
    }

    func testEnglishNamesResolveAsBefore() {
        XCTAssertEqual(Bible.resolveReference("John 3:16"), Reference(order: 43, chapter: 3, verse: 16))
        XCTAssertEqual(Bible.resolveReference("1 John 1:9"), Reference(order: 62, chapter: 1, verse: 9))
        XCTAssertEqual(Bible.resolveReference("Psalm 23"), Reference(order: 19, chapter: 23, verse: nil))
        XCTAssertNil(Bible.resolveReference("Juana 3:16"))
    }

    func testBookNamesCoverAllSixtySixBooks() {
        XCTAssertEqual(BookNames.shared.names(.es).count, 66)
        XCTAssertEqual(BookNames.shared.names(.de).count, 66)
        XCTAssertEqual(BookNames.shared.names(.es)[42], "Juan")
        XCTAssertEqual(BookNames.shared.names(.de)[42], "Johannes")
    }

    func testChatCitationsFindSpanishAndGermanReferences() {
        let spanish = "Como dice Juan 3:16 y tambi\u{00E9}n G\u{00E9}nesis 1:1, Dios es amor."
        XCTAssertEqual(VersePassages.citedReferences(in: spanish), ["Juan 3:16", "G\u{00E9}nesis 1:1"])

        let german = "Lies 1. Johannes 1:9 und R\u{00F6}mer 8:28."
        XCTAssertEqual(VersePassages.citedReferences(in: german), ["1. Johannes 1:9", "R\u{00F6}mer 8:28"])

        XCTAssertEqual(VersePassages.citedReferences(in: "See John 3:16 KJV."), ["John 3:16 KJV"])
    }

    // MARK: - Effective language

    func testAutoFollowsTheDeviceOnlyForSpanishAndGerman() {
        XCTAssertEqual(AnswerLanguageSetting.auto.effective(preferredLanguages: ["es-MX", "en-US"]), .es)
        XCTAssertEqual(AnswerLanguageSetting.auto.effective(preferredLanguages: ["de-DE"]), .de)
        XCTAssertEqual(AnswerLanguageSetting.auto.effective(preferredLanguages: ["fr-FR", "es-ES"]), .en)
        XCTAssertEqual(AnswerLanguageSetting.auto.effective(preferredLanguages: ["en-US", "es-ES"]), .en)
        XCTAssertEqual(AnswerLanguageSetting.auto.effective(preferredLanguages: []), .en)
    }

    func testAnExplicitChoiceWinsOverTheDevice() {
        XCTAssertEqual(AnswerLanguageSetting.en.effective(preferredLanguages: ["de-DE"]), .en)
        XCTAssertEqual(AnswerLanguageSetting.es.effective(preferredLanguages: ["de-DE"]), .es)
        XCTAssertEqual(AnswerLanguageSetting.de.effective(preferredLanguages: ["en-US"]), .de)
    }

    func testSettingNormalizesAndLabels() {
        XCTAssertEqual(AnswerLanguageSetting.normalize(nil), .auto)
        XCTAssertEqual(AnswerLanguageSetting.normalize("fr"), .auto)
        XCTAssertEqual(AnswerLanguageSetting.normalize("de"), .de)
        XCTAssertEqual(
            AnswerLanguageSetting.auto.label(preferredLanguages: ["es-ES"]),
            "Follow my device (Espa\u{00F1}ol)"
        )
        XCTAssertEqual(AnswerLanguageSetting.de.label(), "Deutsch")
        XCTAssertEqual(AnswerLanguage.es.bible, .rv1909)
        XCTAssertEqual(AnswerLanguage.de.bible, .lut1912)
        XCTAssertEqual(AnswerLanguage.en.bible, .kjv)
    }

    // MARK: - Requests

    func testAskQuestionCarriesTheLanguageNextToTheTranslation() throws {
        var request = AskQuestionRequest(
            messages: [],
            conversationId: nil,
            translation: "RV1909",
            modelId: nil,
            effort: nil,
            speed: nil,
            verbosity: nil,
            mode: nil
        )
        XCTAssertNil(try Self.object(request)["language"])
        request.language = "es"
        let object = try Self.object(request)
        XCTAssertEqual(object["language"] as? String, "es")
        XCTAssertEqual(object["translation"] as? String, "RV1909")
    }

    func testVerseInsightCarriesTheLanguage() throws {
        let target = VerseInsightModel.Target(reference: "Johannes 3:16", text: "Also hat Gott", translation: .lut1912)
        let object = try Self.object(VerseInsightModel.Request(target, modelId: nil, language: .de))
        XCTAssertEqual(object["language"] as? String, "de")
        XCTAssertEqual(object["translation"] as? String, "LUT1912")
    }

    private static func object(_ value: some Encodable) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
