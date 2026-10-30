import SwiftUI

/// The Notes pane: library on the left, editor on the right.
///
/// Android pushes `/notes` → `/notes/[id]` as two screens; a wide Mac window has
/// room for both at once. Narrow windows show the selected editor or library. Every
/// capability the Android screens have is reachable here — the form factor
/// changes, the feature set does not.
struct NotesSection: View {
    @Environment(\.theme) private var theme
    /// Only for `pendingNoteID`, the chat note receipt's hop into a note.
    @Environment(AppModel.self) private var app
    let api: APIClient

    @State private var library: NotesLibraryModel?

    var body: some View {
        ZStack {
            MeshBackground()
            if let library {
                content(library)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .task {
            guard library == nil else { return }
            let model = NotesLibraryModel(api: NotesAPI(api: api))
            library = model
            openPendingNote(in: model)
            await model.start()
        }
        .onChange(of: app.pendingNoteID) { openPendingNote(in: library) }
        // Android reloads silently when the app returns to the foreground,
        // to pick up edits made on the web or another device.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            guard let library else { return }
            Task { await library.load(.silent) }
        }
    }

    /// A note receipt tapped in chat stages its note on `AppModel.pendingNoteID`
    /// and selects this section. Consumed once, so coming back to Notes later
    /// does not reopen it. The editor loads the note by id, so one the
    /// assistant just created opens even before the list has fetched it.
    private func openPendingNote(in library: NotesLibraryModel?) {
        guard let library, let noteID = app.pendingNoteID else { return }
        let request = app.currentNoteNavigationRequest()
        Task {
            await app.performNoteNavigation(request) {
                guard app.pendingNoteID == noteID else { return }
                library.selectedNoteID = noteID
                app.pendingNoteID = nil
            }
        }
    }

    @ViewBuilder
    private func content(_ library: NotesLibraryModel) -> some View {
        GeometryReader { geometry in
            let isCompact = geometry.size.width < 740
            let showsLibrary = !isCompact || library.selectedNoteID == nil
            let listWidth = showsLibrary ? (isCompact ? geometry.size.width : 320) : 0
            let dividerWidth: CGFloat = isCompact ? 0 : 1
            let detailWidth = max(0, geometry.size.width - listWidth - dividerWidth)

            // Keep the list and editor in the same view tree while resizing.
            // Recreating an editor would also recreate its draft and AI state.
            HStack(spacing: 0) {
                NotesListPane(library: library, api: api, isVisible: showsLibrary)
                    .frame(width: listWidth)
                    .clipped()
                    .allowsHitTesting(showsLibrary)
                    .accessibilityHidden(!showsLibrary)
                Divider().overlay(theme.border)
                    .frame(width: dividerWidth)
                    .clipped()
                    .accessibilityHidden(isCompact)

                Group {
                    if let noteID = library.selectedNoteID {
                        NoteEditorPane(noteID: noteID, api: api, library: library)
                            // A fresh editor per note: the model seeds its document once
                            // and owns an autosave timer, so reusing it across notes
                            // would write one note's text into another.
                            .id(noteID)
                            .analyticsScreen(AnalyticsScreen.note)
                    } else {
                        emptyDetail
                    }
                }
                .frame(width: detailWidth)
                .clipped()
                .allowsHitTesting(detailWidth > 0)
                .accessibilityHidden(detailWidth == 0)
            }
        }
    }

    private var emptyDetail: some View {
        VStack(spacing: Spacing.sm) {
            Image(systemName: "note.text")
                .appFont(.system(size: 30))
                .foregroundStyle(theme.textGhost)
            Text("Select a note")
                .appFont(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.textMuted)
            // ⌘N is already "New chat" in the app menu, so notes take ⇧⌘N.
            Text("Or press ⇧⌘N to start a new Bible study note.")
                .appFont(.system(size: 12.5))
                .foregroundStyle(theme.textGhost)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Shared helpers

extension Color {
    /// Tag colours arrive as CSS hex strings (`#f59e0b`).
    init(hexString: String, fallback: Color = .gray) {
        var text = hexString.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        if text.count == 3 {
            text = text.map { "\($0)\($0)" }.joined()
        }
        guard text.count == 6, let value = UInt32(text, radix: 16) else {
            self = fallback
            return
        }
        self.init(hex: value)
    }
}
