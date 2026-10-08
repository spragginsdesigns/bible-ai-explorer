import Foundation
import XCTest

@testable import SureWord

/// The Learn card contract and masking ladder: a port of
/// `mobile/src/features/learn/learn.test.ts` and `tests/learn-mask.test.mjs`,
/// same fixtures, same expected strings. `Shared/Learn/LearnCard.swift` is
/// compiled into both Apple targets, so this covers macOS too.
final class LearnContractTests: XCTestCase {
    static let verse = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."
    static let receivedAt = LearnTime.parse("2026-09-12T18:00:00.000Z")!
    static let timezone = "America/Los_Angeles"

    static func card(
        id: String = "a",
        revision: Int = 0,
        stage: Int = 0,
        intervalDays: Int = 0,
        dueAt: String = "2026-09-12T07:00:00.000Z",
        knownAt: String? = nil,
        translation: String = "KJV",
        text: String = verse,
        textUnavailable: Bool? = nil
    ) -> LearnCard {
        LearnCard(
            id: id,
            revision: revision,
            book: 43,
            chapter: 3,
            verse: 16,
            translation: translation,
            reference: "John 3:16",
            text: text,
            textUnavailable: textUnavailable,
            stage: stage,
            intervalDays: intervalDays,
            dueAt: dueAt,
            knownAt: knownAt
        )
    }

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private func json(_ card: LearnCard) -> String {
        String(decoding: try! JSONEncoder().encode(card), as: UTF8.self)
    }

    // MARK: - Masking ladder

    func testStageZeroKeepsTheWholeVerse() {
        XCTAssertEqual(Learn.maskVerse(Self.verse, stage: 0), Self.verse)
    }

    func testStageOneHidesEveryFourthWord() {
        XCTAssertEqual(
            Learn.maskVerse(Self.verse, stage: 1),
            "For God so ____ the world, that ____ gave his only ____ Son, that whosoever ____ in him should ____ perish, but have ____ life."
        )
    }

    func testStageTwoHidesHalfTheWords() {
        XCTAssertEqual(
            Learn.maskVerse(Self.verse, stage: 2),
            "For ____ so ____ the ____, that ____ gave ____ only ____ Son, ____ whosoever ____ in ____ should ____ perish, ____ have ____ life."
        )
    }

    func testStageThreeHidesEveryWord() {
        XCTAssertTrue(Learn.verseWords(Self.verse, stage: 3).allSatisfy(\.hidden))
    }

    func testPunctuationSurvivesAndWhitespaceTrims() {
        XCTAssertEqual(Learn.maskVerse("  “For God so loved,”  ", stage: 3), "“____ ____ ____ ____,”")
    }

    // MARK: - Parsing

    func testAcceptsAnUnavailableTranslationWithoutSubstitutingText() throws {
        let unavailable = try decode(
            LearnCard.self,
            json(Self.card(translation: "NKJV", text: "", textUnavailable: true))
        )
        XCTAssertEqual(unavailable.translation, "NKJV")
        XCTAssertEqual(unavailable.text, "")
        XCTAssertEqual(unavailable.textUnavailable, true)
    }

    func testRejectsMalformedAndDuplicateCards() throws {
        let card = json(Self.card())
        XCTAssertThrowsError(try decode(LearnToday.self, #"{"cards":[\#(card),\#(card)],"knownCount":0,"queueCount":2}"#))
        let unknown = json(Self.card(translation: "unknown"))
        XCTAssertThrowsError(try decode(LearnToday.self, #"{"cards":[\#(unknown)],"knownCount":0,"queueCount":1}"#))
        // knownAt must be present (null or an instant), as `parseCard` demands.
        // Dictionary key order is per-process, so the key may lead the object
        // (no comma before it); strip it in either position.
        let missingKnownAt = card
            .replacingOccurrences(of: #""knownAt":null,"#, with: "")
            .replacingOccurrences(of: #","knownAt":null"#, with: "")
        XCTAssertNotEqual(missingKnownAt, card)
        XCTAssertThrowsError(try decode(LearnCard.self, missingKnownAt))
        XCTAssertThrowsError(try decode(LearnCard.self, json(Self.card(stage: 4))))
        XCTAssertThrowsError(try decode(LearnCard.self, json(Self.card(text: "   "))))
        XCTAssertThrowsError(try decode(LearnCard.self, json(Self.card(dueAt: "tomorrow"))))
        let four = (1...4).map { json(Self.card(id: "c\($0)")) }.joined(separator: ",")
        XCTAssertThrowsError(try decode(LearnToday.self, #"{"cards":[\#(four)],"knownCount":0,"queueCount":4}"#))
    }

    func testRoundTripsThroughItsOwnEncoding() throws {
        let card = Self.card(knownAt: "2026-09-12T18:00:00.000Z")
        XCTAssertEqual(try decode(LearnCard.self, json(card)), card)
    }

    // MARK: - Receipts

    private func operation(_ before: LearnCard, _ result: LearnResult, _ id: String) -> LearnReviewOperation {
        LearnReviewOperation(
            result: result,
            operationId: id,
            expectedRevision: before.revision,
            reviewedAt: LearnTime.format(Self.receivedAt),
            timezone: Self.timezone
        )
    }

    private func apply(
        _ today: LearnToday,
        _ before: LearnCard,
        _ result: LearnResult,
        _ current: LearnCard?,
        _ id: String,
        replayed: Bool = false
    ) throws -> LearnToday {
        let payload = operation(before, result, id)
        let receipt = LearnReviewAcknowledgement(
            operationId: id,
            appliedRevision: before.revision + 1,
            replayed: replayed,
            currentCard: current
        )
        try receipt.validate(expectedOperationID: id)
        return try Learn.applyReviewAcknowledgement(
            today,
            before: before,
            operation: payload,
            acknowledgement: receipt,
            receivedAt: Self.receivedAt,
            timezone: Self.timezone
        )
    }

    func testAppliesAReplayedReceiptAndRejectsAMismatchedOne() throws {
        let card = Self.card()
        let id = "11111111-1111-4111-8111-111111111111"
        let next = try apply(
            LearnToday(cards: [card], knownCount: 0, queueCount: 1),
            card,
            .good,
            Self.card(revision: 1, stage: 1),
            id,
            replayed: true
        )
        XCTAssertEqual(next.cards.first?.revision, 1)
        XCTAssertEqual(next.cards.first?.stage, 1)

        let mismatched = LearnReviewAcknowledgement(
            operationId: "22222222-2222-4222-8222-222222222222",
            appliedRevision: 1,
            replayed: true,
            currentCard: Self.card(revision: 1, stage: 1)
        )
        XCTAssertThrowsError(try mismatched.validate(expectedOperationID: id))
        // A receipt whose card is older than the revision it claims to have applied.
        let stale = LearnReviewAcknowledgement(operationId: id, appliedRevision: 2, replayed: false, currentCard: card)
        XCTAssertThrowsError(try stale.validate(expectedOperationID: id))
    }

    func testUsesTheDeviceDayBoundaryForAReplaysCurrentSchedule() throws {
        let before = Self.card(stage: 3)
        let today = LearnToday(cards: [before], knownCount: 0, queueCount: 1)
        let id = "33333333-3333-4333-8333-333333333333"
        let sameDay = try apply(
            today, before, .good,
            Self.card(revision: 2, stage: 3, dueAt: "2026-09-12T23:00:00.000Z"),
            id, replayed: true
        )
        let nextDay = try apply(
            today, before, .good,
            Self.card(revision: 2, stage: 3, dueAt: "2026-09-13T07:00:00.000Z"),
            id, replayed: true
        )
        XCTAssertEqual(sameDay.cards.count, 1)
        XCTAssertEqual(nextDay.cards, [])
    }

    func testSameDayStagesStayOnScreenAndAgainResetsToStageOne() throws {
        let card = Self.card()
        let stageOne = try apply(
            LearnToday(cards: [card], knownCount: 0, queueCount: 1),
            card, .good, Self.card(revision: 1, stage: 1),
            "11111111-1111-4111-8111-111111111111"
        )
        XCTAssertEqual(stageOne.cards.first?.stage, 1)

        let recall = Self.card(revision: 3, stage: 3)
        let reset = try apply(
            LearnToday(cards: [recall], knownCount: 0, queueCount: 1),
            recall, .again, Self.card(revision: 4, stage: 1),
            "22222222-2222-4222-8222-222222222222"
        )
        XCTAssertEqual(reset.cards.count, 1)
    }

    func testACompletedRecallLeavesTodayAndCountsKnownOnce() throws {
        let before = Self.card(revision: 3, stage: 3)
        let updated = Self.card(
            revision: 4,
            stage: 3,
            intervalDays: 16,
            dueAt: "2026-09-28T07:00:00.000Z",
            knownAt: "2026-09-12T18:00:00.000Z"
        )
        let after = try apply(
            LearnToday(cards: [before], knownCount: 0, queueCount: 1),
            before, .good, updated, "33333333-3333-4333-8333-333333333333"
        )
        XCTAssertEqual(after, LearnToday(cards: [], knownCount: 1, queueCount: 1))

        var knownBefore = updated
        knownBefore.dueAt = "2026-09-12T07:00:00.000Z"
        var knownAfter = knownBefore
        knownAfter.revision = 5
        knownAfter.dueAt = "2026-10-14T07:00:00.000Z"
        let again = try apply(
            LearnToday(cards: [knownBefore], knownCount: 1, queueCount: 1),
            knownBefore, .good, knownAfter, "44444444-4444-4444-8444-444444444444"
        )
        XCTAssertEqual(again.knownCount, 1)
    }

    func testAReplayUsesItsLatestScheduleAndRemovesACardDueAfterToday() throws {
        let before = Self.card(revision: 3, stage: 3)
        let newer = Self.card(revision: 6, stage: 3, intervalDays: 8, dueAt: "2026-09-20T07:00:00.000Z")
        let after = try apply(
            LearnToday(cards: [before], knownCount: 0, queueCount: 1),
            before, .good, newer, "55555555-5555-4555-8555-555555555555", replayed: true
        )
        XCTAssertEqual(after.cards, [])
    }

    func testRejectsAReceiptForADifferentVerse() throws {
        let card = Self.card()
        XCTAssertThrowsError(try apply(
            LearnToday(cards: [card], knownCount: 0, queueCount: 1),
            card, .good, Self.card(id: "b", revision: 1, stage: 1),
            "66666666-6666-4666-8666-666666666666"
        ))
    }

    func testKeepsCachedTextWhenAReceiptCannotResolveTheSameTranslation() {
        let previous = Self.card()
        let current = Self.card(revision: 1, text: "", textUnavailable: true)
        let preserved = Learn.preserveCardText(previous, current)
        XCTAssertEqual(preserved.text, Self.verse)
        XCTAssertNil(preserved.textUnavailable)
        // A different translation is never borrowed.
        let nkjv = Self.card(revision: 1, translation: "NKJV", text: "", textUnavailable: true)
        XCTAssertEqual(Learn.preserveCardText(previous, nkjv), nkjv)
    }

    // MARK: - Review route responses (`reviewLearnCard`)

    func testReviewResponsesMapToFailuresTheSyncStoreActsOn() throws {
        let id = "77777777-7777-4777-8777-777777777777"
        let current = Self.card(revision: 5, stage: 2)
        let conflictBody = #"{"code":"revision_conflict","error":"Newer schedule","currentCard":\#(json(current))}"#
        XCTAssertThrowsError(try LearnAPI.interpret(status: 409, data: Data(conflictBody.utf8), operationID: id)) { error in
            let failure = error as? LearnReviewFailure
            XCTAssertEqual(failure?.code, .revisionConflict)
            XCTAssertEqual(failure?.currentCard, current)
            XCTAssertEqual(failure?.offline, false)
        }
        XCTAssertThrowsError(try LearnAPI.interpret(status: 404, data: Data("{}".utf8), operationID: id)) { error in
            XCTAssertEqual((error as? LearnReviewFailure)?.code, .missing)
        }
        XCTAssertThrowsError(try LearnAPI.interpret(status: 500, data: Data(#"{"error":"boom"}"#.utf8), operationID: id)) { error in
            let failure = error as? LearnReviewFailure
            XCTAssertNil(failure?.code)
            XCTAssertEqual(failure?.message, "boom")
        }
        let receipt = #"{"operationId":"\#(id)","appliedRevision":1,"replayed":false,"currentCard":null}"#
        let acknowledgement = try LearnAPI.interpret(status: 200, data: Data(receipt.utf8), operationID: id)
        XCTAssertNil(acknowledgement.currentCard)
        XCTAssertThrowsError(try LearnAPI.interpret(
            status: 200,
            data: Data(receipt.utf8),
            operationID: "88888888-8888-4888-8888-888888888888"
        ))
    }
}
