import Foundation

extension Notification.Name {
    /// Posted by the chat tab when a retrieved-verse card asks to open the
    /// passage in the Bible reader. The reference is in `userInfo["reference"]`;
    /// TabShell (Lane 5/Lane 6) is the single observer — it stages the
    /// reference on `AppModel.pendingVerseReference` and selects the Bible tab,
    /// whose root consumes the pending value and pushes the reader.
    static let openBibleVerse = Notification.Name("sureword.openBibleVerse")

    /// Posted when a note-action receipt asks to open the note it wrote.
    /// The note id is in `userInfo["noteId"]`; TabShell is the single
    /// observer — it stages the id on `AppModel.pendingNoteID` and selects the
    /// Notes tab, whose root consumes the pending value and pushes the editor.
    static let openNote = Notification.Name("sureword.openNote")
}
