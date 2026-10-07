import Foundation

/// Snapshot undo/redo for a note editor that replaces its text storage
/// wholesale.
///
/// The iOS editor applies every structural command (headings, lists, quotes,
/// a task checkbox, Return out of a list) by re-rendering the document into
/// the `UITextView`'s storage. UIKit's typing undo knows nothing about those
/// replacements, so an undo stack that mixed the two would replay typing
/// ranges against a document they were never recorded on. This history owns
/// both instead: it stores the document *before* each edit and restores it
/// whole, which is correct for any kind of edit by construction.
///
/// Typing coalesces the way UIKit's own typing undo does: one entry per burst,
/// where a burst ends at a pause, a newline, a caret move, or any non-typing
/// edit. Pure value logic, generic over the snapshot, so both platforms' tests
/// pin it without a text view.
struct NoteEditHistory<Snapshot> {
    /// Typing within this window of the previous keystroke joins its entry.
    static var typingPause: Duration { .seconds(1) }

    let limit: Int

    private(set) var undoStack: [Snapshot] = []
    private(set) var redoStack: [Snapshot] = []

    /// True while a typing burst is open, so its keystrokes share one entry.
    private var isCoalescingTyping = false
    private var lastTypingAt: ContinuousClock.Instant?

    init(limit: Int = 200) {
        self.limit = max(limit, 1)
    }

    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }

    /// A non-typing edit is about to happen: it always gets its own entry and
    /// closes any open typing burst.
    mutating func recordEdit(before snapshot: Snapshot) {
        push(snapshot)
        isCoalescingTyping = false
    }

    /// Typing is about to change the text. Pushes `before` only when this
    /// keystroke starts a new burst; `before` is an autoclosure so a coalesced
    /// keystroke never pays for building a snapshot. Returns whether it pushed.
    @discardableResult
    mutating func recordTyping(
        before snapshot: @autoclosure () -> Snapshot,
        replacement: String,
        at now: ContinuousClock.Instant
    ) -> Bool {
        let paused = lastTypingAt.map { now - $0 > Self.typingPause } ?? true
        var pushed = false
        if !isCoalescingTyping || paused {
            push(snapshot())
            pushed = true
        }
        lastTypingAt = now
        // A newline closes the burst after itself, so each paragraph typed in
        // one go undoes separately - what UIKit and the web editor both do.
        isCoalescingTyping = !replacement.contains("\n")
        return pushed
    }

    /// The caret moved somewhere typing did not put it: the next keystroke
    /// starts a new entry.
    mutating func endTypingBurst() {
        isCoalescingTyping = false
    }

    /// Returns the snapshot to restore, after parking `current` for redo.
    mutating func undo(current: Snapshot) -> Snapshot? {
        guard let previous = undoStack.popLast() else { return nil }
        redoStack.append(current)
        isCoalescingTyping = false
        return previous
    }

    mutating func redo(current: Snapshot) -> Snapshot? {
        guard let next = redoStack.popLast() else { return nil }
        undoStack.append(current)
        isCoalescingTyping = false
        return next
    }

    /// A freshly loaded document has no history - undoing past a load would
    /// resurrect a different version of the note.
    mutating func reset() {
        undoStack.removeAll()
        redoStack.removeAll()
        isCoalescingTyping = false
        lastTypingAt = nil
    }

    private mutating func push(_ snapshot: Snapshot) {
        undoStack.append(snapshot)
        if undoStack.count > limit {
            undoStack.removeFirst(undoStack.count - limit)
        }
        // Any new edit forks history; the undone future is gone.
        redoStack.removeAll()
    }
}
