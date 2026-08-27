import Foundation
import Testing
@testable import SureWord

/// Mirrors `mobile/src/features/chat/questionPresentation.test.ts` case for
/// case, so the gold caption above every opening question means the same thing
/// on macOS and iOS as it does on Android and web.
@Suite("QuestionPresentation")
struct QuestionPresentationTests {
    private let enDash = "\u{2013}"

    @Test("Preserves every generated question in its original order")
    func preservesOrder() {
        let questions = [
            SuggestedQuestionInput(
                question: "How does Romans 8:26\(enDash)27 encourage me when I do not know what to pray?",
                label: "Romans 8:26"
            ),
            SuggestedQuestionInput(
                question: "What can I learn from Jacob wrestling with God in Genesis 32?",
                label: "Genesis 32"
            ),
            SuggestedQuestionInput(
                question: "How should I explain being born again to my children?",
                label: "APPLY"
            ),
        ]
        #expect(
            QuestionPresentation.buildItems(questions).map(\.question)
                == questions.map(\.question)
        )
    }

    @Test("Shows only references that actually occur in the generated question")
    func referencesFromTheQuestion() {
        #expect(
            QuestionPresentation.questionReference("What does Acts 9:17-19 show about Ananias?")
                == "Acts 9:17\(enDash)19"
        )
        #expect(
            QuestionPresentation.questionReference("What can I learn from Genesis 32?")
                == "Genesis 32"
        )
        #expect(
            QuestionPresentation
                .questionReference("How should I explain being born again to my children?") == nil
        )
    }

    @Test("Normalizes a reference the model wrote loosely")
    func normalizesLooseReferences() {
        #expect(QuestionPresentation.parseReferenceLabel("james 3:5-6") == "James 3:5\(enDash)6")
        #expect(QuestionPresentation.parseReferenceLabel("1samuel 3") == "1 Samuel 3")
        #expect(
            QuestionPresentation.parseReferenceLabel("song of solomon 2:1") == "Song of Solomon 2:1"
        )
        #expect(QuestionPresentation.parseReferenceLabel("Genesis 1-2") == "Genesis 1\(enDash)2")
    }

    @Test("Rejects a label that is not a whole reference")
    func rejectsPartialReferences() {
        #expect(QuestionPresentation.parseReferenceLabel("APPLY") == nil)
        #expect(QuestionPresentation.parseReferenceLabel("What Genesis 1 teaches") == nil)
        #expect(QuestionPresentation.parseReferenceLabel("Hezekiah 4:2") == nil)
    }

    @Test("Renders the server's label in upper case, whatever kind it is")
    func upperCasesEveryLabel() {
        let items = QuestionPresentation.buildItems([
            SuggestedQuestionInput(question: "What did I write about patience?", label: "YOUR NOTES"),
            SuggestedQuestionInput(
                question: "How do I carry today's word into work?", label: "TODAY'S VERSE"
            ),
            SuggestedQuestionInput(
                question: "What does James 3 say about the tongue?", label: "James 3:5"
            ),
        ])
        #expect(items.map(\.label) == ["YOUR NOTES", "TODAY'S VERSE", "JAMES 3:5"])
    }

    @Test("Falls back to the question's own reference only when no label was sent")
    func fallsBackToTheQuestionReference() {
        let items = QuestionPresentation.buildItems([
            SuggestedQuestionInput(
                question: "What does Acts 9:17-19 show about Ananias?", label: nil
            ),
            SuggestedQuestionInput(question: "What can I learn from Genesis 32?", label: nil),
            SuggestedQuestionInput(question: "How should I pray at work?", label: nil),
        ])
        #expect(items.map(\.label) == ["ACTS 9:17\(enDash)19", "GENESIS 32", nil])
    }

    @Test("Chip keys stay distinct when the model repeats a question")
    func keysAreDistinct() {
        let items = QuestionPresentation.buildItems(["Same question?", "Same question?"])
        #expect(items[0].key != items[1].key)
    }

    // MARK: Response parsing

    private func parse(_ json: String) -> [SuggestedQuestionInput] {
        SuggestedQuestionsAPI.parse(Data(json.utf8))
    }

    @Test("Reads the labelled items and falls back to the plain questions array")
    func prefersItems() {
        #expect(
            parse(
                """
                {"questions":["What does James 3 say about the tongue?"],
                 "items":[{"question":"What does James 3 say about the tongue?","label":"James 3:5"}],
                 "personalized":true}
                """
            ) == [
                SuggestedQuestionInput(
                    question: "What does James 3 say about the tongue?", label: "James 3:5"
                )
            ]
        )

        // A deploy that predates labels: only the plain array is there.
        #expect(
            parse("""
            {"questions":["What can I learn from Genesis 32?"],"personalized":true}
            """) == [
                SuggestedQuestionInput(question: "What can I learn from Genesis 32?", label: nil)
            ]
        )

        #expect(parse("{\"questions\":[],\"items\":[]}").isEmpty)
        #expect(parse("null").isEmpty)
        #expect(parse("not json").isEmpty)
    }

    @Test("Skips malformed entries rather than failing the whole payload")
    func skipsMalformedEntries() {
        #expect(
            parse(
                """
                {"items":[{"question":"What does James 3 say about the tongue?","label":"James 3:5"},
                          "What can I learn from Genesis 32?",
                          {"question":"","label":"APPLY"},
                          {"label":"MEMORY"},
                          null,
                          42]}
                """
            ) == [
                SuggestedQuestionInput(
                    question: "What does James 3 say about the tongue?", label: "James 3:5"
                ),
                SuggestedQuestionInput(question: "What can I learn from Genesis 32?", label: nil),
            ]
        )
    }
}
