import Foundation
import XCTest

@testable import SureWord

/// "Quiz me" on Apple: the Codable mirror of `src/lib/quiz-contract.ts`, the
/// pure rules both apps' screens read, and a mirror check that reads the
/// TypeScript contract itself so a field added there fails here first.
@MainActor
final class QuizTests: XCTestCase {
    private static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // SureWord-iOSTests
        .deletingLastPathComponent() // macos
        .deletingLastPathComponent() // repo

    private static let fixture = """
    {
      "book": 43, "chapter": 3, "bookName": "John", "title": "John 3",
      "depth": "seeking", "suggestedDepth": "growing",
      "questions": [
        {"id": "q1", "prompt": "Who came to Jesus by night?",
         "options": ["Nicodemus", "Peter", "John", "Andrew"], "answerIndex": 0,
         "verses": [1, 2], "reference": "John 3:1-2",
         "verseText": "There was a man of the Pharisees, named Nicodemus, a ruler of the Jews:",
         "note": null},
        {"id": "q2", "prompt": "What must happen before a man can see the kingdom of God?",
         "options": ["Keep the law", "Be born again", "Be baptized", "Sell all"], "answerIndex": 1,
         "verses": [3], "reference": "John 3:3",
         "verseText": "Jesus answered and said unto him, Verily, verily, I say unto thee, Except a man be born again, he cannot see the kingdom of God.",
         "note": "Born again is the door to the kingdom."},
        {"id": "q3", "prompt": "What was lifted up in the wilderness?",
         "options": ["Aaron's rod", "The serpent", "The ark", "A cloud"], "answerIndex": 1,
         "verses": [14], "reference": "John 3:14",
         "verseText": "And as Moses lifted up the serpent in the wilderness, even so must the Son of man be lifted up:",
         "note": null}
      ],
      "reflection": {"verse": 16, "reference": "John 3:16",
        "verseText": "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
        "prompt": "What does that change about today for you?"},
      "model": "gpt-5.6-luna", "cached": true
    }
    """

    private func decodeFixture() throws -> ChapterQuiz {
        try JSONDecoder().decode(ChapterQuiz.self, from: Data(Self.fixture.utf8))
    }

    // MARK: Decoding

    func testDecodesAChapterQuiz() throws {
        let quiz = try decodeFixture()
        XCTAssertEqual(quiz.book, 43)
        XCTAssertEqual(quiz.title, "John 3")
        XCTAssertEqual(quiz.depth, .seeking)
        XCTAssertEqual(quiz.suggestedDepth, .growing)
        XCTAssertEqual(quiz.questions.count, 3)
        XCTAssertNil(quiz.questions[0].note)
        XCTAssertEqual(quiz.questions[1].note, "Born again is the door to the kingdom.")
        XCTAssertEqual(quiz.questions[1].options[quiz.questions[1].answerIndex], "Be born again")
        XCTAssertEqual(quiz.reflection?.verse, 16)
        XCTAssertTrue(quiz.cached)
    }

    func testDecodesANullReflectionAndModel() throws {
        let json = """
        {"book":1,"chapter":1,"bookName":"Genesis","title":"Genesis 1","depth":"growing",
         "suggestedDepth":"growing","questions":[],"reflection":null,"model":null,"cached":false}
        """
        let quiz = try JSONDecoder().decode(ChapterQuiz.self, from: Data(json.utf8))
        XCTAssertNil(quiz.reflection)
        XCTAssertNil(quiz.model)
        XCTAssertEqual(quiz.depth, .growing)
    }

    func testTheResponseMapsErrorsToTheirCopy() throws {
        let ok = try QuizAPI.interpret(status: 200, data: Data(Self.fixture.utf8))
        XCTAssertEqual(ok.questions.count, 3)

        func message(_ status: Int, _ body: String) -> String? {
            do {
                _ = try QuizAPI.interpret(status: status, data: Data(body.utf8))
                return nil
            } catch let error as QuizAPI.LoadError {
                return error.message
            } catch {
                return "unexpected"
            }
        }
        XCTAssertEqual(message(403, #"{"error":"AI is turned off for your account."}"#), "AI is turned off for your account.")
        XCTAssertEqual(message(429, #"{"error":"Slow down a little.","code":"rate_limited"}"#), "Slow down a little.")
        XCTAssertEqual(message(400, "{}"), QuizAPI.unavailableMessage)
        XCTAssertEqual(message(502, #"{"error":"x","code":"unavailable"}"#), "This quiz could not be written right now.")
        XCTAssertEqual(message(200, "not json"), QuizAPI.unavailableMessage)
    }

    // MARK: Rules

    func testVerseLabels() {
        XCTAssertEqual(QuizRules.verseLabel(reference: "John 3:3"), "FROM VERSE 3")
        XCTAssertEqual(QuizRules.verseLabel(reference: "John 3:3-5"), "FROM VERSES 3-5")
        XCTAssertEqual(QuizRules.verseLabel(reference: "John 3:3,5"), "FROM VERSES 3, 5")
        XCTAssertEqual(QuizRules.verseLabel(reference: "1 John 4:8, 16"), "FROM VERSES 8, 16")
        XCTAssertEqual(QuizRules.verseLabel(reference: "John 3", verses: [16]), "FROM VERSE 16")
        XCTAssertEqual(QuizRules.verseLabel(reference: "John 3", verses: [3, 5]), "FROM VERSES 3, 5")
    }

    func testOptionLetters() {
        XCTAssertEqual((0..<4).map(QuizRules.letter), ["A", "B", "C", "D"])
    }

    func testResultsCopy() {
        XCTAssertEqual(QuizRules.headline(correct: 4, total: 5), "You remembered 4 of 5")
        XCTAssertEqual(QuizRules.subline(missed: 0), "Every answer, straight from the Word.")
        XCTAssertEqual(QuizRules.subline(missed: 1), "Here is the one worth another look.")
        XCTAssertEqual(QuizRules.subline(missed: 3), "Here are the ones worth another look.")
        XCTAssertEqual(QuizRules.loadingLine(title: "John 3"), "Writing your questions from John 3...")
        XCTAssertEqual(
            QuizRules.askPrompt(reference: "John 3:3", prompt: "Why?"),
            "Help me understand John 3:3: Why?"
        )
    }

    func testNextChapterCrossesBooksAndStopsAtRevelation22() {
        XCTAssertEqual(QuizRules.nextChapter(book: 43, chapter: 3)?.title, "John 4")
        XCTAssertEqual(QuizRules.nextChapter(book: 43, chapter: 21)?.title, "Acts 1")
        XCTAssertEqual(QuizRules.nextChapter(book: 43, chapter: 21)?.location, Bible.Location(order: 44, chapter: 1))
        XCTAssertNil(QuizRules.nextChapter(book: 66, chapter: 22))
    }

    func testAttemptBodyCountsMissedAndUnanswered() throws {
        let quiz = try decodeFixture()
        // q1 right, q2 wrong, q3 never answered.
        let attempt = QuizRules.attempt(for: quiz, answers: ["q1": 0, "q2": 3])
        XCTAssertEqual(
            attempt,
            QuizAttemptInput(book: 43, chapter: 3, depth: .seeking, total: 3, correct: 1, missedVerses: [3, 14])
        )
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(attempt)) as? [String: Any]
        XCTAssertEqual(Set(body.map { Array($0.keys) } ?? []), ["book", "chapter", "depth", "total", "correct", "missedVerses"])
        XCTAssertEqual(body?["depth"] as? String, "seeking")
    }

    func testReflectionNoteIsEscapedAndShaped() throws {
        let reflection = try XCTUnwrap(decodeFixture().reflection)
        XCTAssertEqual(QuizRules.reflectionTitle("John 3"), "John 3 reflection")
        let html = QuizRules.reflectionHTML(reflection: reflection, words: "He loves <me>.\n\nAnd you & all.")
        XCTAssertTrue(html.hasPrefix("<blockquote><p><strong>John 3:16</strong></p><p>For God so loved"))
        XCTAssertTrue(html.contains("</blockquote><p><em>What does that change about today for you?</em></p>"))
        XCTAssertTrue(html.hasSuffix("<p>He loves &lt;me&gt;.</p><p>And you &amp; all.</p>"))
    }

    func testDismissalsAreCappedNewestLast() throws {
        let suite = "QuizTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        XCTAssertFalse(QuizDismissals.contains(book: 43, chapter: 3, defaults: defaults))
        QuizDismissals.dismiss(book: 43, chapter: 3, defaults: defaults)
        XCTAssertTrue(QuizDismissals.contains(book: 43, chapter: 3, defaults: defaults))
        XCTAssertFalse(QuizDismissals.contains(book: 43, chapter: 4, defaults: defaults))

        let many = (1...250).map { "1:\($0)" }
        XCTAssertEqual(QuizDismissals.capped(many).count, QuizDismissals.limit)
        XCTAssertEqual(QuizDismissals.capped(many).last, "1:250")
        XCTAssertEqual(QuizDismissals.capped(many).first, "1:51")
    }

    func testDepthLabelsNeverDescribeThePerson() {
        XCTAssertEqual(QuizDepth.allCases.map(\.label), ["Foundations", "Going deeper"])
    }

    // MARK: Mirror of quiz-contract.ts

    /// Field names of one `export interface` in the TypeScript contract.
    private func tsFields(_ source: String, _ interface: String) throws -> Set<String> {
        let pattern = try Regex("export interface \(interface)\\s*\\{([\\s\\S]*?)\\n\\}")
        let block = try XCTUnwrap(source.firstMatch(of: pattern)?.output[1].substring, "\(interface) not found")
        var names = Set<String>()
        for line in block.split(separator: "\n") {
            if let match = line.firstMatch(of: /^\s*(\w+)\??\s*:/) {
                names.insert(String(match.output.1))
            }
        }
        return names
    }

    private func swiftFields(_ value: Any) -> Set<String> {
        Set(Mirror(reflecting: value).children.compactMap(\.label))
    }

    func testTheSwiftModelsMirrorTheTypeScriptContract() throws {
        let source = try String(
            contentsOf: Self.repoRoot.appending(path: "src/lib/quiz-contract.ts"),
            encoding: .utf8
        )
        let quiz = try decodeFixture()
        let attempt = QuizRules.attempt(for: quiz, answers: [:])

        let pairs: [(String, Any)] = [
            ("ChapterQuiz", quiz),
            ("QuizQuestion", quiz.questions[0]),
            ("QuizReflection", try XCTUnwrap(quiz.reflection)),
            ("QuizAttemptInput", attempt),
        ]
        for (name, value) in pairs {
            let ts = try tsFields(source, name)
            XCTAssertGreaterThan(ts.count, 2, "expected real fields for \(name)")
            XCTAssertEqual(swiftFields(value), ts, "\(name) drifted from src/lib/quiz-contract.ts")
        }

        XCTAssertTrue(source.contains("QUIZ_LENGTH = \(QuizContract.length);"))
        XCTAssertTrue(source.contains("QUIZ_OPTION_COUNT = \(QuizContract.optionCount);"))
        let depths = try XCTUnwrap(source.firstMatch(of: /export type QuizDepth = ([^;]+);/)?.output.1)
        XCTAssertEqual(
            Set(depths.matches(of: /"(\w+)"/).map { String($0.output.1) }),
            Set(QuizDepth.allCases.map(\.rawValue))
        )
    }
}
