import Testing
@testable import SureWord

/// The pure half of the receipts line: which fragments a turn's receipts become,
/// and the two strings the shells need when a target has no screen to open. The
/// contract is `docs/FEATURES.md` -> "Receipts: one line for everything the
/// assistant saves"; the parser that produces the receipts themselves is pinned
/// by `ChatReceiptTests`.
@Suite("Receipt line")
struct ReceiptLineTests {

    private let note = ChatReceipt(
        id: "call_note",
        kind: .note,
        label: "Saved to Romans study",
        target: .note(noteID: "note_1")
    )

    private let remembered = ChatReceipt(
        id: "call_memory",
        kind: .memory,
        label: "Remembered",
        target: .memories(memoryID: "mem_1"),
        undo: .forgetMemory(memoryID: "mem_1")
    )

    @Test("No receipts means no fragments")
    func empty() {
        #expect(ReceiptFragment.build(receipts: []).isEmpty)
    }

    @Test("Every receipt is one fragment, and only the last has no separator")
    func oneFragmentEach() {
        let cross = ChatReceipt(id: "call_cross", kind: .cross, label: "Today's cross: John 3:16", target: .cross)
        let fragments = ReceiptFragment.build(receipts: [note, cross])

        #expect(fragments.map(\.label) == ["Saved to Romans study", "Today's cross: John 3:16"])
        #expect(fragments.map(\.isLast) == [false, true])
        #expect(fragments.map(\.role) == [.open(note), .open(cross)])
        #expect(Set(fragments.map(\.id)).count == 2)
    }

    @Test("A memory receipt carries an Undo fragment right after it")
    func undoFollowsItsReceipt() {
        let fragments = ReceiptFragment.build(receipts: [remembered, note])

        #expect(fragments.map(\.label) == ["Remembered", "Undo", "Saved to Romans study"])
        #expect(fragments[1].role == .undo(receiptID: "call_memory", memoryID: "mem_1"))
        #expect(fragments.map(\.isLast) == [false, false, true])
    }

    @Test("An undone memory becomes one Forgotten fragment, never Remembered and Forgotten")
    func forgotten() {
        let fragments = ReceiptFragment.build(receipts: [remembered, note], forgotten: ["call_memory"])

        #expect(fragments.map(\.label) == ["Forgotten", "Saved to Romans study"])
        #expect(fragments[0].role == .forgotten)
        #expect(fragments.map(\.isLast) == [false, true])
    }

    @Test("A receipt without an undo is never rewritten by the forgotten set")
    func noUndoWithoutOne() {
        let updated = ChatReceipt(
            id: "call_update",
            kind: .memory,
            label: "Memory updated",
            target: .memories(memoryID: "mem_2")
        )
        let fragments = ReceiptFragment.build(receipts: [updated], forgotten: ["call_update"])

        #expect(fragments.map(\.label) == ["Memory updated"])
        #expect(fragments.map(\.role) == [.open(updated)])
    }

    @Test("A chapter target becomes a reference the reader can resolve")
    func chapterReference() {
        #expect(ReceiptLine.chapterReference(book: 43, chapter: 3, verse: 16) == "John 3:16")
        #expect(ReceiptLine.chapterReference(book: 43, chapter: 3, verse: nil) == "John 3")
        #expect(ReceiptLine.chapterReference(book: 67, chapter: 1, verse: 1) == nil)
    }

    @Test("A settings target names the section to open")
    func settingsMessages() {
        #expect(ReceiptLine.settingsMessage(for: .memory) == "Open Settings \u{2192} Memory")
        #expect(ReceiptLine.settingsMessage(for: .church) == "Open Settings \u{2192} My church")
        #expect(ReceiptLine.settingsMessage(for: .preferences) == "Open Settings \u{2192} Web Search")
        #expect(ReceiptLine.settingsMessage(for: nil) == "Open Settings to see that change.")
    }
}
