import Testing
@testable import SureWord

/// VoiceOver names for the note editor bar: the tooltip without its shortcut,
/// never the SF Symbol's own name.
struct NoteFormattingToolbarTests {
    @Test("A shortcut in parentheses is not spoken")
    func dropsShortcut() {
        #expect(NoteFormattingToolbar.spokenName("Bold (⌘B)") == "Bold")
        #expect(NoteFormattingToolbar.spokenName("Outdent (⇧⇥)") == "Outdent")
    }

    @Test("A name without a shortcut is spoken as written")
    func keepsPlainName() {
        #expect(NoteFormattingToolbar.spokenName("Link to a note") == "Link to a note")
        #expect(NoteFormattingToolbar.spokenName("Heading 2") == "Heading 2")
    }
}
