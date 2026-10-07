import Foundation

/// What the verse sheet is looking at: the chapter on screen in the reader.
struct VerseSheetContext: Sendable, Equatable {
    let order: Int
    let bookName: String
    let chapter: Int
    /// Every verse's plain text, verse 1 at index 0 (`ReaderVerse.plainText`).
    let plainTexts: [String]
    let translation: TranslationID
}

/// State and rules behind the two-tier verse sheet - the slice of
/// `mobile/app/(app)/bible/chapter.tsx` that owns the selection, the tier, the
/// study tab and the action bar's transient states. The SwiftUI sheet only
/// draws this; every rule that decides what a tap does lives here, so the
/// tests can drive it without a view.
@MainActor
@Observable
final class VerseSheetModel {
    enum Tier: Sendable, Equatable { case peek, expanded }

    enum StudyTab: String, CaseIterable, Identifiable, Sendable {
        case explain, words, seeAlso

        var id: String { rawValue }

        var label: String {
            switch self {
            case .explain: "Explain"
            case .words: "Words"
            case .seeAlso: "See also"
            }
        }
    }

    enum LearnStatus: Sendable, Equatable { case idle, adding, added }

    struct Message: Sendable, Equatable {
        enum Tone: Sendable, Equatable { case muted, danger }
        let text: String
        let tone: Tone
    }

    /// A quick second tap grows the range; wait for the reader to settle
    /// before asking the model.
    static let selectionSettle = Duration.milliseconds(350)
    /// Longer than the sheet's slide-out, so what it shows does not vanish
    /// mid-slide.
    static let closeDelay = Duration.milliseconds(320)
    static let copiedDuration = Duration.milliseconds(1400)

    static let saveError = "The note could not be saved. Check your connection and try again."
    static let learnError = "Could not add to Learn. Check your connection and try again."

    /// Nil means the sheet is closed.
    private(set) var selection: VerseSelection?
    /// The last non-nil selection: the sheet's content stays stable while it
    /// animates closed.
    private(set) var shownSelection = VerseSelection(start: 1, end: 1)
    var tier: Tier = .peek
    var studyTab: StudyTab = .explain
    private(set) var copied = false
    private(set) var saveBusy = false
    private(set) var learnStatus: LearnStatus = .idle
    var actionMessage: Message?

    let insight: VerseInsightModel

    private var settleTask: Task<Void, Never>?
    private var closeTask: Task<Void, Never>?
    private var copiedTask: Task<Void, Never>?

    init(insight: VerseInsightModel) {
        self.insight = insight
    }

    var isOpen: Bool { selection != nil }
    var activeSelection: VerseSelection { selection ?? shownSelection }

    /// The study view covers the chapter; the peek leaves it readable.
    var obscuresReader: Bool { isOpen && tier == .expanded }

    func reference(_ context: VerseSheetContext) -> String {
        activeSelection.reference(bookName: context.bookName, chapter: context.chapter)
    }

    func text(_ context: VerseSheetContext) -> String {
        activeSelection.text(in: context.plainTexts)
    }

    func shareText(_ context: VerseSheetContext) -> String {
        VerseSelection.shareText(
            reference: reference(context),
            text: text(context),
            translation: context.translation.rawValue
        )
    }

    /// "3 verses" under the title, only for a range.
    var subtitle: String? {
        activeSelection.count > 1 ? "\(activeSelection.count) verses" : nil
    }

    // MARK: - Tapping

    /// The reader's tap. Returns false when the cap refused the tap (the bar
    /// says why), true otherwise.
    @discardableResult
    func tap(_ verse: Int, context: VerseSheetContext) -> Bool {
        let current = selection
        let next = VerseSelection.toggle(current, verse: verse)
        if next == current {
            // The only way the toggle leaves the selection alone is the cap.
            actionMessage = Message(text: VerseSelection.capMessage, tone: .muted)
            return false
        }
        if let next { shownSelection = next }
        if current == nil, next != nil {
            // A fresh open starts at the peek on Explain with clean action state.
            tier = .peek
            studyTab = .explain
        }
        // A grown or re-anchored range is a different thing to copy or learn.
        copied = false
        copiedTask?.cancel()
        learnStatus = .idle
        actionMessage = nil
        selection = next
        selectionChanged(from: current, context: context)
        return true
    }

    /// Close the sheet. The insight keeps its text while the sheet slides out
    /// and is abandoned once the slide is done.
    func close() {
        let wasOpen = selection != nil
        selection = nil
        copied = false
        actionMessage = nil
        settleTask?.cancel()
        guard wasOpen else { return }
        scheduleInsightReset()
    }

    private func scheduleInsightReset() {
        closeTask?.cancel()
        closeTask = Task { [insight] in
            try? await Task.sleep(for: Self.closeDelay)
            guard !Task.isCancelled else { return }
            insight.reset()
        }
    }

    /// The chapter or translation changed under an open sheet: the selection
    /// no longer describes what is on screen.
    func chapterChanged() {
        selection = nil
        copied = false
        actionMessage = nil
        settleTask?.cancel()
        closeTask?.cancel()
        insight.reset()
    }

    func openStudy(_ tab: StudyTab) {
        studyTab = tab
        tier = .expanded
    }

    func toggleTier() {
        tier = tier == .expanded ? .peek : .expanded
    }

    func retryInsight(_ context: VerseSheetContext) {
        guard selection != nil else { return }
        insight.start(target(context))
    }

    /// Tap-a-verse: a selection immediately starts streaming its explanation
    /// (cached per reference for the session). The first tap asks at once; a
    /// tap that grows the range waits a beat in case another follows.
    private func selectionChanged(from previous: VerseSelection?, context: VerseSheetContext) {
        settleTask?.cancel()
        guard selection != nil else {
            scheduleInsightReset()
            return
        }
        closeTask?.cancel()
        let target = target(context)
        guard previous != nil else {
            insight.start(target)
            return
        }
        settleTask = Task { [insight] in
            try? await Task.sleep(for: Self.selectionSettle)
            guard !Task.isCancelled else { return }
            insight.start(target)
        }
    }

    private func target(_ context: VerseSheetContext) -> VerseInsightModel.Target {
        VerseInsightModel.Target(
            reference: reference(context),
            text: text(context),
            translation: context.translation
        )
    }

    // MARK: - Actions

    func markCopied() {
        copied = true
        copiedTask?.cancel()
        copiedTask = Task {
            try? await Task.sleep(for: Self.copiedDuration)
            guard !Task.isCancelled else { return }
            copied = false
        }
    }

    /// Save the selection as a new note. Returns the note id for the caller to
    /// open, or nil after showing the failure on the bar.
    func saveToNote(api: APIClient, context: VerseSheetContext) async -> String? {
        guard selection != nil, !saveBusy else { return nil }
        saveBusy = true
        actionMessage = nil
        defer { saveBusy = false }
        do {
            return try await VerseActions.saveToNote(
                api: api,
                reference: reference(context),
                text: text(context),
                translation: context.translation
            )
        } catch {
            actionMessage = Message(text: Self.saveError, tone: .danger)
            return nil
        }
    }

    /// Learn takes one verse per request, so a range is added verse by verse;
    /// the route is idempotent, so a retry after a mid-way failure is safe.
    /// `source` is "highlight" when the selection shares a colour, as on
    /// Android. Returns true once every verse is in.
    @discardableResult
    func addToLearn(
        context: VerseSheetContext,
        highlighted: Bool,
        post: (_ body: VerseLearnRequest) async throws -> VerseLearnCard
    ) async -> Bool {
        guard let selection, learnStatus == .idle else { return false }
        learnStatus = .adding
        actionMessage = nil
        do {
            for verse in selection.verses {
                let card = try await post(
                    VerseLearnRequest(
                        book: context.order,
                        chapter: context.chapter,
                        verse: verse,
                        translation: context.translation.rawValue,
                        source: highlighted ? "highlight" : "sheet"
                    )
                )
                guard card.book == context.order, card.chapter == context.chapter, card.verse == verse else {
                    throw BibleError(message: "Unexpected verse")
                }
            }
            learnStatus = .added
            actionMessage = Message(
                text: selection.count == 1 ? "Added to Learn." : "Added \(selection.count) verses to Learn.",
                tone: .muted
            )
            return true
        } catch {
            learnStatus = .idle
            actionMessage = Message(text: Self.learnError, tone: .danger)
            return false
        }
    }
}

/// `POST /api/learn` body - the route Android's sheet calls.
struct VerseLearnRequest: Encodable, Sendable, Equatable {
    let book: Int
    let chapter: Int
    let verse: Int
    let translation: String
    let source: String
}

/// The part of the Learn card the sheet checks: that the server added the
/// verse it was asked for. The full card model belongs to the Learn feature.
struct VerseLearnCard: Decodable, Sendable, Equatable {
    let id: String
    let book: Int
    let chapter: Int
    let verse: Int
}
