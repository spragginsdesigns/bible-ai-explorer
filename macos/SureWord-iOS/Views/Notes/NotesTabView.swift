import SwiftUI

/// The Notes tab root — owns the shared `NotesLibraryModel` for the whole tab
/// and routes into the editor. Port of `mobile/app/(app)/notes/index.tsx`'s
/// stack behaviour: the list is the root, a note pushes the editor.
struct NotesTabView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.theme) private var theme
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.scenePhase) private var scenePhase

    /// Optional because it needs the session's API client, which only exists in
    /// the environment once the tab is on screen. Created exactly once — the
    /// store behind it keeps the list warm across tab switches.
    @State private var library: NotesLibraryModel?
    /// The note pushed onto the stack; nil means the list is showing.
    @State private var openedNoteID: String?

    var body: some View {
        Group {
            if let library {
                if sizeClass == .regular {
                    NavigationSplitView {
                        NotesLibraryView(library: library) { openNote($0) }
                            .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 400)
                    } detail: {
                        let destination = $openedNoteID
                        if let openedNoteID {
                            NoteEditorView(
                                noteID: openedNoteID, api: app.api,
                                onDeleted: { destination.wrappedValue = nil },
                                onClose: { destination.wrappedValue = nil }
                            )
                                .id(openedNoteID)
                                .analyticsScreen(AnalyticsScreen.note)
                        } else {
                            ContentUnavailableView("Open a note", systemImage: "note.text", description: Text("Choose a note from your library, or start a new one."))
                        }
                    }
                } else {
                    NotesLibraryView(library: library) { openNote($0) }
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.bg.ignoresSafeArea())
        .navigationTitle("Notes")
        .settingsGearToolbar()
        .navigationDestination(item: Binding(get: { sizeClass == .regular ? nil : openedNoteID }, set: { openNote($0) })) { noteID in
            let destination = $openedNoteID
            NoteEditorView(noteID: noteID, api: app.api, onClose: { destination.wrappedValue = nil })
                .analyticsScreen(AnalyticsScreen.note)
        }
        .task {
            guard library == nil else { return }
            let model = NotesLibraryModel(api: NotesAPI(api: app.api))
            library = model
            await model.start()
        }
        // Android reloads silently when the app returns to the foreground,
        // to pick up edits made on the web or another device.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, let library else { return }
            Task { await library.load(.silent) }
        }
        // A note receipt tapped in chat lands here (staged by TabShell).
        // Consume it once: the tab root is long-lived, so leaving the value
        // set would re-push the editor every time the Notes tab reappears.
        .onChange(of: app.pendingNoteID, initial: true) { _, pending in
            guard let pending else { return }
            Task {
                guard await app.noteDeparture.canLeave() else { return }
                openedNoteID = pending
                app.pendingNoteID = nil
            }
        }
    }

    private func openNote(_ id: String?) {
        guard id != openedNoteID else { return }
        Task {
            guard await app.noteDeparture.canLeave() else { return }
            openedNoteID = id
        }
    }
}
