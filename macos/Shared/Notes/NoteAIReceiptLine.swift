import SwiftUI

/// Generic saved-action receipts in a note's AI conversation, using the same
/// fragments and undo behavior as chat while leaving presentation to its owner.
@MainActor
struct NoteAIReceiptLine: View {
    @Environment(AppModel.self) private var app
    @Environment(\.theme) private var theme

    let receipts: [ChatReceipt]
    var onClose: () -> Void

    @State private var receiptError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ReceiptLineView(
                receipts: receipts,
                api: app.api,
                onOpen: openReceipt,
                onError: { receiptError = $0 }
            )
            if let receiptError {
                Text(receiptError)
                    .appFont(.footnote)
                    .foregroundStyle(theme.danger)
            }
        }
    }

    private func openReceipt(_ receipt: ChatReceipt) {
        let userID = app.userID
        let request = app.beginNoteNavigation()

        Task {
            // A receipt must save/settle the current note before closing its AI UI.
            await app.performNoteNavigation(request) {
                guard app.userID == userID else { return }

                if case .chapter(let book, let chapter, let verse, let translation) = receipt.target {
                    guard let raw = ReceiptLine.chapterReference(book: book, chapter: chapter, verse: verse),
                          let reference = VerseLinks.readerReference(for: raw) else {
                        receiptError = "That passage could not be opened."
                        return
                    }
                    receiptError = nil
                    onClose()
                    #if os(iOS)
                    var userInfo: [String: Any] = ["reference": reference]
                    if let translation { userInfo["translation"] = translation.rawValue }
                    NotificationCenter.default.post(name: .openBibleVerse, object: nil, userInfo: userInfo)
                    #else
                    app.openVerse(reference, translation: translation)
                    #endif
                    return
                }

                receiptError = nil
                onClose()
                switch receipt.target {
                case .note(let noteID):
                    #if os(iOS)
                    NotificationCenter.default.post(name: .openNote, object: nil, userInfo: ["noteId": noteID])
                    #else
                    app.openNote(noteID)
                    #endif
                case .memories:
                    app.openSettings(.memory)
                case .plan:
                    app.openDaily(.plan)
                case .readingHistory:
                    app.openDaily(.history)
                case .learn:
                    app.openDaily(.learn)
                case .cross:
                    app.dailyCross.load(force: true)
                    #if os(iOS)
                    NotificationCenter.default.post(name: .openDailyCross, object: nil)
                    #else
                    app.section = .cross
                    #endif
                case .settings(let section):
                    if let page = ReceiptLine.settingsPage(for: section) {
                        app.openSettings(page)
                    } else {
                        app.pendingSettingsPage = nil
                        app.isSettingsPresented = true
                    }
                case .chapter:
                    break // Validated and dispatched before closing above.
                }
            }
        }
    }
}
