import Foundation
import Testing

@testable import SureWord

/// PRD D3 on the phone: the answer actions behave as Android's do. Mirrors the
/// pure halves of `receiptRoutes.test.ts`, `shareApi.test.ts`,
/// `answerFeedback.test.ts` and `chatProgress.test.ts`.
@Suite("Answer actions match Android (D3)")
struct AnswerActionsParityTests {
    @Test("Each receipt fragment says where its tap goes, in Android's words")
    func receiptDestinations() {
        #expect(ReceiptLine.destinationLabel(for: .note(noteID: "n")) == "Opens the note.")
        #expect(ReceiptLine.destinationLabel(for: .memories(memoryID: nil)) == "Opens your memories.")
        #expect(
            ReceiptLine.destinationLabel(for: .chapter(book: 43, chapter: 3, verse: 16, translation: nil))
                == "Opens the chapter in the Bible reader."
        )
        #expect(ReceiptLine.destinationLabel(for: .plan) == "Opens your reading plan.")
        #expect(ReceiptLine.destinationLabel(for: .readingHistory) == "Opens your reading history.")
        #expect(ReceiptLine.destinationLabel(for: .cross) == "Opens Pick Up Your Cross.")
        #expect(ReceiptLine.destinationLabel(for: .learn) == "Opens Learn.")
        #expect(ReceiptLine.destinationLabel(for: .settings(section: .church)) == "Opens Settings.")
        #expect(ReceiptLine.undoAccessibilityLabel == "Undo. Forgets what was just remembered.")
        #expect(ReceiptLine.forgetError == "Could not forget that memory. Try again in a moment.")
    }

    @Test("A revoked share is never shown as listed, whatever the row says")
    func revokedIsUnlisted() throws {
        let json = """
        {"shares":[
          {"id":"a","url":"https://sureword.app/shared/a","question":"Q","revokedAt":"2026-10-01T00:00:00.000Z","listed":true},
          {"id":"b","url":"https://sureword.app/shared/b","question":"","revokedAt":null,"listed":true}
        ]}
        """
        let rows = try JSONDecoder().decode(SharedAnswersResponse.self, from: Data(json.utf8)).shares
        #expect(rows[0].listed == false)
        #expect(rows[1].listed)
        // Android's blank-question title.
        #expect(rows[1].title == "An answer you shared")
    }

    @Test("Chips travel in the order they were tapped, once each")
    func chipsInTapOrder() throws {
        let body = AnswerFeedbackRequest(feedback: .down, tags: [.tooLong, .notKJV, .tooLong])
        #expect(body.feedbackTags == [.tooLong, .notKJV])
    }

    @Test("Copy keeps text after the follow-up block and code samples, as Android does")
    func copyIsLineBased() {
        let message = ChatViewMessage(
            id: "a",
            role: .assistant,
            content: "Answer.\n[FOLLOWUP] Next?\nPS: Romans 8:28."
        )
        #expect(message.copyableText == "Answer.\nPS: Romans 8:28.")
    }

    @Test("Work history icons check the step's kind before its state")
    func activityIcons() {
        #expect(WorkActivityEntryRow.symbol(kind: "status", state: "running") == "circle")
        #expect(WorkActivityEntryRow.symbol(kind: "tool", state: "interrupted") == "minus")
        #expect(WorkActivityEntryRow.symbol(kind: "tool", state: "running") == "ellipsis")
        #expect(WorkActivityEntryRow.symbol(kind: "summary", state: "complete") == "sparkles")
        #expect(WorkActivityEntryRow.symbol(kind: "tool", state: "error") == "exclamationmark.circle")
        #expect(WorkActivityEntryRow.symbol(kind: "tool", state: "complete") == "checkmark")
    }

    @Test("A reopened answer keeps its \"Worked for\" snapshot")
    func progressSurvivesRestore() throws {
        let row = try JSONDecoder().decode(
            JSONValue.self,
            from: Data(
                """
                {"id": "a", "role": "assistant", "content": "Answer",
                 "metadata": {"parts": [
                   {"type": "data-progress", "id": "progress", "data": {
                     "version": 1, "runId": "run", "sequence": 2, "elapsedMs": 9000,
                     "lastActivityMs": 8000, "state": "complete", "phase": "answering",
                     "label": "Work completed", "entries": []
                   }},
                   {"type": "text", "text": "Answer"}
                 ]}}
                """.utf8
            )
        )
        let message = try #require(UIMessage(storedRow: row))
        #expect(ChatViewMessage(message: message, isStreaming: false).progress?.elapsedMs == 9000)
    }
}
