import SwiftUI

/// The Notes tab root — owns the shared `NotesLibraryModel` for the whole tab
/// and routes into the editor. Port of `mobile/app/(app)/notes/index.tsx`'s
/// stack behaviour: the list is the root, a note pushes the editor.
struct NotesTabView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.theme) private var theme

    /// Optional because it needs the session's API client, which only exists in
    /// the environment once the tab is on screen. Created exactly once — the
    /// store behind it keeps the list warm across tab switches.
    @State private var library: NotesLibraryModel?
    /// The note pushed onto the stack; nil means the list is showing.
    @State private var openedNoteID: String?

    var body: some View {
        Group {
            if let library {
                NotesLibraryView(library: library) { noteID in
                    openedNoteID = noteID
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.bg.ignoresSafeArea())
        .navigationTitle("Notes")
        .settingsGearToolbar()
        .navigationDestination(item: $openedNoteID) { noteID in
            NoteEditorView(noteID: noteID, api: app.api)
        }
        .task {
            guard library == nil else { return }
            let model = NotesLibraryModel(api: NotesAPI(api: app.api))
            library = model
            await model.start()
        }
        // A note receipt tapped in chat lands here (staged by TabShell).
        // Consume it once: the tab root is long-lived, so leaving the value
        // set would re-push the editor every time the Notes tab reappears.
        .onChange(of: app.pendingNoteID, initial: true) { _, pending in
            guard let pending else { return }
            openedNoteID = pending
            app.pendingNoteID = nil
        }
    }
}
