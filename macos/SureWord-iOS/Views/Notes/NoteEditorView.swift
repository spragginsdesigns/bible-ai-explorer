import SwiftUI
import UIKit

/// The note editor — a port of `mobile/app/(app)/notes/[id].tsx`.
///
/// Title field, the rich-text surface (`NoteEditorTextView` over the shared
/// controller), a formatting bar above the keyboard, and the per-note AI
/// conversation as a sheet — Android presents it as a slide-up sheet too, so
/// the phone keeps the same shape on both platforms.
///
/// Saving is the shared `NoteEditorModel`'s job: edits debounce into an
/// autosave, and this view flushes on the two exits the debounce can miss —
/// back navigation and app backgrounding (Android's AppState listener).
struct NoteEditorView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.theme) private var theme
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss

    let noteID: String
    let api: APIClient
    let onDeleted: (() -> Void)?
    let onClose: (() -> Void)?

    @State private var model: NoteEditorModel
    @State private var ai: NoteAIModel
    @State private var isAIPresented = false
    @State private var isTagSheetPresented = false
    @State private var isDeleteConfirming = false
    @State private var isLinkAlertPresented = false
    @State private var linkTarget = ""
    @State private var isInfoPresented = false
    @State private var isWikilinkPickerPresented = false
    /// A note opened from the info sheet's links, pushed on top of this one
    /// the way Android's `router.push` stacks editors.
    @State private var linkedNoteID: String?
    @State private var pinHapticTick = 0
    // Editor menu (PRD E2).
    @State private var shareText: NoteShareText?
    @State private var exportError: String?
    @State private var copiedTick = 0
    @State private var isCopiedVisible = false
    @State private var departureID = UUID()
    @FocusState private var isTitleFocused: Bool

    init(noteID: String, api: APIClient, onDeleted: (() -> Void)? = nil, onClose: (() -> Void)? = nil) {
        self.onDeleted = onDeleted
        self.onClose = onClose
        self.noteID = noteID
        self.api = api
        _model = State(initialValue: NoteEditorModel(noteID: noteID, api: NotesAPI(api: api)))
        _ai = State(initialValue: NoteAIModel(noteID: noteID, api: api))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            integrityStatus

            if model.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                NoteEditorTextView(controller: model.controller) {
                    NoteFormattingToolbar(
                        controller: model.controller,
                        onEditLink: {
                            linkTarget = ""
                            isLinkAlertPresented = true
                        },
                        onInsertWikilink: { isWikilinkPickerPresented = true }
                    )
                    .disabled(!model.allowsUserEditing)
                }
                .disabled(!model.allowsUserEditing)
            }
        }
        .background(theme.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle("")
        .navigationBarBackButtonHidden(true)
        .toolbar { toolbarItems }
        .alert("Link", isPresented: $isLinkAlertPresented) {
            TextField("https://…", text: $linkTarget)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Apply") { model.controller.setLink(linkTarget) }
            Button("Remove Link") { model.controller.setLink(nil) }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $isTagSheetPresented) {
            NoteTagSheet(model: model)
        }
        .sheet(isPresented: $isAIPresented) {
            NoteAISheet(ai: ai)
        }
        .sheet(isPresented: $isWikilinkPickerPresented) {
            InsertWikilinkSheet(currentNoteID: noteID) { title in
                model.controller.insertText(NoteWikilinks.format(title))
            }
        }
        .sheet(isPresented: $isInfoPresented) {
            NoteInfoSheet(
                model: model,
                folderName: NotesStore.shared.folders
                    .first { $0.id == model.note?.folderId }?.name
            ) { id in
                linkedNoteID = id
            }
        }
        .navigationDestination(item: $linkedNoteID) { id in
            let destination = $linkedNoteID
            NoteEditorView(noteID: id, api: api, onClose: { destination.wrappedValue = nil })
        }
        .sheet(item: $shareText) { share in
            NoteMarkdownShareSheet(text: share.text)
                .presentationDetents([.medium, .large])
        }
        .alert(
            "Couldn't export this note",
            isPresented: Binding(get: { exportError != nil }, set: { if !$0 { exportError = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(exportError ?? "")
        }
        .overlay(alignment: .top) {
            if isCopiedVisible {
                Label("Copied as Markdown", systemImage: "checkmark")
                    .appFont(.footnote.weight(.semibold))
                    .foregroundStyle(theme.accent)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.top, Spacing.sm)
                    .transition(.opacity)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
        .sensoryFeedback(.success, trigger: copiedTick)
        .confirmationDialog(
            "Delete \u{201C}\(noteTitle)\u{201D}? This cannot be undone.",
            isPresented: $isDeleteConfirming,
            titleVisibility: .visible
        ) {
            Button("Delete Note", role: .destructive) {
                Task {
                    if await model.delete() {
                        await model.finishEditing(flushPendingChanges: false)
                        if let onDeleted { onDeleted() } else { closeEditor() }
                    }
                }
            }
        }
        .task {
            let editor = model
            let assistant = ai
            let destination = $linkedNoteID
            app.noteDeparture.register(owner: departureID) { [editor] in await editor.canLeaveEditor() }
            editor.start()
            assistant.bindEditor(editor)
            editor.controller.onOpenWikilink = { [weak editor, destination] id in
                Task { @MainActor [weak editor, destination] in
                    guard let editor, await editor.canLeaveEditor() else { return }
                    destination.wrappedValue = id
                }
            }
        }
        .onChange(of: NotesStore.shared.notes) {
            // A note created, renamed or aliased can resolve a drawn link.
            model.controller.refreshWikilinks()
        }
        .onChange(of: isTitleFocused) { _, focused in
            if !focused { commitTitle() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Flush before the app can be suspended — the debounce's Task does
            // not outlive backgrounding, so without this the last seconds of an
            // edit vanish when the user leaves the app mid-thought.
            if phase == .background {
                let model = model
                Task { await model.flush() }
            }
        }
        .onDisappear {
            app.noteDeparture.unregister(owner: departureID)
            // Last-chance write: the pane can go away between the debounce
            // firing and the PATCH landing.
            let model = model
            Task { await model.flush() }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: pinHapticTick)
    }

    private var integrityStatus: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let message = model.integrityMessage {
                Text(message).appFont(.footnote).foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if model.canCheckCanonical {
                    Button("Check saved note") {
                        Task { if await model.retryCanonicalCheck() { ai.didReconcileNote() } }
                    }
                }
            }
        }
        .padding(.horizontal, Spacing.md)
    }

    /// The presenter owns this editor's selection. An inherited dismiss can
    /// target the Study ancestor instead of this note's destination.
    private func closeEditor() {
        if let onClose { onClose() } else { dismiss() }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                // Pinning lives in the More menu (Android's top bar), so the
                // state stays readable at a glance without costing a button.
                if model.note?.isPinned == true {
                    Image(systemName: "pin.fill")
                        .appFont(.system(size: 12))
                        .foregroundStyle(theme.accent)
                        .accessibilityLabel("Pinned")
                }
                TextField("Untitled Note", text: Binding(get: { model.draftTitle }, set: { model.setDraftTitle($0) }))
                    .appFont(.title3.weight(.semibold))
                    .foregroundStyle(theme.text)
                    .focused($isTitleFocused)
                    .onSubmit(commitTitle)
                    .disabled(!model.allowsUserEditing)
            }

            if model.isSaving {
                Text("Saving…")
                    .appFont(.caption2)
                    .foregroundStyle(theme.textGhost)
            } else if let error = model.error {
                Text(error)
                    .appFont(.caption2)
                    .foregroundStyle(theme.danger)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Toolbar

    /// Android's editor bar (`NoteEditorTopBar`): back (the navigation bar's
    /// own), the title with its pin mark, the AI toggle and the note menu.
    /// Everything else about the note lives in that menu, in Android's order.
    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                Task {
                    guard await model.canLeaveEditor() else { return }
                    await model.finishEditing()
                    closeEditor()
                }
            } label: {
                Label("Notes", systemImage: "chevron.left")
            }
            .accessibilityLabel("Back to notes")
        }
        ToolbarItem(placement: .topBarTrailing) {
            HStack(spacing: 4) {
                Button {
                    openAI()
                } label: {
                    Image(systemName: "sparkles")
                        .foregroundStyle(isAIPresented ? theme.accent : theme.textMuted)
                }
                .accessibilityLabel("AI assistant")

                Menu {
                    noteMenu
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(theme.textMuted)
                }
                .accessibilityLabel("Note menu")
            }
        }
    }

    /// The shared note menu (`Shared/Notes/NoteActionMenu.swift`) with every
    /// row, as Android's editor passes every handler to `NoteActionSheet`.
    @ViewBuilder
    private var noteMenu: some View {
        if let note = model.note {
            NoteActionMenu(
                note: note,
                folders: NotesStore.shared.folders,
                onTogglePin: {
                    pinHapticTick += 1
                    Task { await model.togglePin() }
                },
                onMoveToFolder: { folderID in Task { await model.move(toFolder: folderID) } },
                onDelete: { isDeleteConfirming = true },
                onOpenTags: { isTagSheetPresented = true },
                onOpenInfo: openInfo,
                onCopyMarkdown: copyMarkdown,
                onShareMarkdown: shareMarkdown
            )
        }
    }

    private var noteTitle: String {
        let title = model.note?.title ?? ""
        return title.isEmpty ? "Untitled Note" : title
    }

    /// Flush first, as Android does before its info sheet, so the word count
    /// is the one on screen.
    private func openInfo() {
        Task {
            guard await model.flush() else { return }
            isInfoPresented = true
        }
    }

    private func copyMarkdown() {
        do {
            let markdown = try NoteEditorMarkdown.markdown(title: NoteEditorMarkdown.exportTitle(draft: model.draftTitle), controller: model.controller)
            UIPasteboard.general.string = markdown
            guard UIPasteboard.general.string == markdown else {
                exportError = "The draft could not be copied. Try again before leaving this note."
                return
            }
            copiedTick += 1
            model.didCopyRetainedDraft()
            withAnimation { isCopiedVisible = true }
            Task {
                try? await Task.sleep(for: .milliseconds(1200))
                withAnimation { isCopiedVisible = false }
            }
        } catch {
            exportError = error.localizedDescription
        }
    }

    private func shareMarkdown() {
        do {
            shareText = NoteShareText(text: try NoteEditorMarkdown.markdown(title: NoteEditorMarkdown.exportTitle(draft: model.draftTitle), controller: model.controller))
        } catch {
            exportError = error.localizedDescription
        }
    }

    private func commitTitle() {
        Task { await model.flush() }
    }

    /// Save before opening the panel so the assistant reads the current text,
    /// not the last autosave — the same ordering as `openAI` on Android.
    private func openAI() {
        Task {
            guard await model.flush() else { return }
            isAIPresented = true
        }
    }
}

// MARK: - Tag sheet

/// Tag picker for the open note — the iOS sheet form of the Mac's
/// `NoteTagPopover`, a port of `NoteTagSheet.tsx`.
private struct NoteTagSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: NoteEditorModel

    @State private var isCreating = false
    @State private var name = ""
    @State private var color = TagPalette.colors[0]

    private var tags: [Tag] { NotesStore.shared.tags }

    var body: some View {
        NavigationStack {
            List {
                if tags.isEmpty, !isCreating {
                    Text("No tags yet.")
                        .appFont(.subheadline)
                        .foregroundStyle(theme.textGhost)
                        .listRowBackground(Color.clear)
                }

                ForEach(tags) { tag in
                    let isSelected = model.note?.tagIds.contains(tag.id) == true
                    Button {
                        Task { await model.toggleTag(id: tag.id) }
                    } label: {
                        HStack(spacing: Spacing.sm) {
                            Circle()
                                .fill(isSelected ? TagColor.color(tag.color) : .clear)
                                .frame(width: 12, height: 12)
                                .overlay {
                                    Circle().strokeBorder(TagColor.color(tag.color), lineWidth: 1.5)
                                }
                            Text(tag.name)
                                .appFont(.body)
                                .foregroundStyle(isSelected ? theme.text : theme.textSecondary)
                            Spacer()
                            if isSelected {
                                Image(systemName: "checkmark")
                                    .appFont(.caption)
                                    .foregroundStyle(theme.accent)
                            }
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(Color.clear)
                }

                Section {
                    if isCreating {
                        TextField("Tag name", text: $name)
                            .onSubmit(create)
                        HStack(spacing: Spacing.md) {
                            ForEach(TagPalette.colors, id: \.self) { preset in
                                Button {
                                    color = preset
                                } label: {
                                    Circle()
                                        .fill(TagColor.color(preset))
                                        .frame(width: 24, height: 24)
                                        .overlay {
                                            Circle().strokeBorder(
                                                color == preset ? theme.text : .clear,
                                                lineWidth: 2
                                            )
                                        }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Tag color \(preset)")
                            }
                        }
                        HStack {
                            Button("Create", action: create)
                                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                            Spacer()
                            Button("Cancel", role: .cancel) { reset() }
                        }
                    } else {
                        Button {
                            isCreating = true
                        } label: {
                            Label("New tag", systemImage: "plus")
                                .foregroundStyle(theme.accent)
                        }
                    }
                }
                .listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
            .navigationTitle("Tags")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func create() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let chosen = color
        Task { await model.createTag(name: trimmed, color: chosen) }
        reset()
    }

    private func reset() {
        isCreating = false
        name = ""
        color = TagPalette.colors[0]
    }
}
