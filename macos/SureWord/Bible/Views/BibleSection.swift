import SwiftUI

/// The Bible section: book picker on the left, chapter grid or reader on the
/// right. Android splits these across four pushed screens
/// (`mobile/app/(app)/bible/*`); a Mac window is wide enough to keep the picker
/// and the search field permanently visible, which is the only difference.
struct BibleSection: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    /// Owned by `AppModel`, not by this view: switching to chat and back
    /// destroys `BibleSection`, and reader state that died with it would send
    /// the user back to "Choose a book" every time.
    private var model: BibleModel { app.bible }
    @State private var showingAtlas = false
    @State private var atlasBook: Int?
    @State private var atlasChapter: Int?

    var body: some View {
        HStack(spacing: 0) {
            BibleSidebar(
                model: model,
                onShowAtlas: {
                    atlasBook = nil
                    atlasChapter = nil
                    showingAtlas = true
                },
                onShowBible: { showingAtlas = false }
            )
                .frame(width: 300)

            Divider().overlay(theme.border)

            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background { MeshBackground() }
        .navigationTitle("Bible")
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                Text(toast)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textSecondary)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
                    .background(theme.bgElevated, in: .rect(cornerRadius: Radius.full))
                    .overlay {
                        Capsule().strokeBorder(theme.border, lineWidth: 1)
                    }
                    .padding(.bottom, Spacing.xl)
                    .transition(.opacity)
            }
        }
        .animation(.snappy, value: model.toast)
        // A verse reference tapped in chat lands here. Consume it once: the
        // reader is a long-lived pane, so leaving the value set would re-open
        // the same verse every time the section is shown.
        .onChange(of: app.pendingVerseReference, initial: true) { _, pending in
            guard let pending else { return }
            showingAtlas = false
            atlasBook = nil
            atlasChapter = nil
            if let reference = Bible.resolveReference(pending) {
                model.open(reference)
            }
            app.pendingVerseReference = nil
        }
    }

    @ViewBuilder
    private var detail: some View {
        if showingAtlas {
            AtlasExplorerPane(
                model: app.atlas,
                onOpenReference: { rawReference in
                    guard let reference = Bible.resolveReference(rawReference) else { return }
                    showingAtlas = false
                    atlasBook = nil
                    atlasChapter = nil
                    model.open(reference)
                },
                onDismiss: {
                    showingAtlas = false
                    atlasBook = nil
                    atlasChapter = nil
                },
                scopedBook: atlasBook,
                scopedChapter: atlasChapter
            )
        } else if model.selectedBook == nil {
            emptyState
        } else {
            switch model.pane {
            case .chapters:
                ChapterGridPane(model: model)
            case .reader:
                ChapterReaderPane(
                    model: model,
                    askAI: askAI,
                    showAtlas: { book, chapter in
                        atlasBook = book
                        atlasChapter = chapter
                        showingAtlas = true
                    }
                )
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: "book.closed")
                .font(.system(size: 28))
                .foregroundStyle(theme.textGhost)
            Text("Choose a book")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text)
            Text("All 66 books of the King James Bible are bundled with the app and read offline.")
                .font(.system(size: 12))
                .foregroundStyle(theme.textMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Attach the passage to the next question and switch to chat — the Mac
    /// equivalent of Android pushing "/" with `?attachRef&attachText`.
    private func askAI(reference: String, text: String) {
        app.chat.attachment = VerseAttachment(
            reference: reference,
            text: text,
            translation: app.settings.translation
        )
        model.dismissVerseActions()
        app.section = .chat
    }
}
