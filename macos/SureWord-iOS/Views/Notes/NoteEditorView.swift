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
    @Environment(\.theme) private var theme
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss

    let noteID: String
    let api: APIClient

    @State private var model: NoteEditorModel
    @State private var ai: NoteAIModel
    @State private var draftTitle = ""
    @State private var isAIPresented = false
    @State private var isTagSheetPresented = false
    @State private var isDeleteConfirming = false
    @State private var isLinkAlertPresented = false
    @State private var linkTarget = ""
    @State private var pinHapticTick = 0
    @FocusState private var isTitleFocused: Bool

    init(noteID: String, api: APIClient) {
        self.noteID = noteID
        self.api = api
        _model = State(initialValue: NoteEditorModel(noteID: noteID, api: NotesAPI(api: api)))
        _ai = State(initialValue: NoteAIModel(noteID: noteID, api: api))
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            if model.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                NoteEditorTextView(controller: model.controller)
            }
        }
        .background(theme.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle("")
        .navigationBarBackButtonHidden(false)
        .toolbar { toolbarItems }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                NoteFormattingToolbar(controller: model.controller) {
                    linkTarget = ""
                    isLinkAlertPresented = true
                }
            }
        }
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
        .confirmationDialog(
            "Delete this note? This cannot be undone.",
            isPresented: $isDeleteConfirming,
            titleVisibility: .visible
        ) {
            Button("Delete Note", role: .destructive) {
                Task {
                    await model.delete()
                    dismiss()
                }
            }
        }
        .task {
            model.start()
            ai.onNoteAppended = { event in
                guard event.noteID == noteID else { return }
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                Task { await model.reloadAfterAIAppend() }
            }
        }
        .onChange(of: model.note?.title) { _, title in
            if !isTitleFocused { draftTitle = title ?? "" }
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
            // Last-chance write: the pane can go away between the debounce
            // firing and the PATCH landing.
            let model = model
            Task { await model.flush() }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: pinHapticTick)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField("Untitled Note", text: $draftTitle)
                .font(.title3.weight(.semibold))
                .foregroundStyle(theme.text)
                .focused($isTitleFocused)
                .onSubmit(commitTitle)
                .onAppear { draftTitle = model.note?.title ?? "" }

            if model.isSaving {
                Text("Saving…")
                    .font(.caption2)
                    .foregroundStyle(theme.textGhost)
            } else if let error = model.error {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(theme.danger)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            HStack(spacing: 4) {
                Button {
                    pinHapticTick += 1
                    Task { await model.togglePin() }
                } label: {
                    Image(systemName: model.note?.isPinned == true ? "pin.fill" : "pin")
                        .foregroundStyle(model.note?.isPinned == true ? theme.accent : theme.textMuted)
                }
                .accessibilityLabel(model.note?.isPinned == true ? "Unpin note" : "Pin note")

                Button {
                    isTagSheetPresented = true
                } label: {
                    Image(systemName: "tag")
                        .foregroundStyle(
                            (model.note?.tagIds.isEmpty == false) ? theme.accent : theme.textMuted
                        )
                }
                .accessibilityLabel("Tags")

                Menu {
                    Menu("Move to Folder") {
                        Button("No Folder") { Task { await model.move(toFolder: nil) } }
                        ForEach(NotesStore.shared.folders) { folder in
                            Button(folder.name) {
                                Task { await model.move(toFolder: folder.id) }
                            }
                        }
                    }
                    Divider()
                    Button("Delete Note", role: .destructive) { isDeleteConfirming = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(theme.textMuted)
                }
                .accessibilityLabel("Note actions")

                Button {
                    openAI()
                } label: {
                    Image(systemName: "sparkles")
                        .foregroundStyle(theme.textMuted)
                }
                .accessibilityLabel("AI assistant")
            }
        }
    }

    private func commitTitle() {
        let trimmed = draftTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != model.note?.title else { return }
        Task { await model.rename(to: draftTitle) }
    }

    /// Save before opening the panel so the assistant reads the current text,
    /// not the last autosave — the same ordering as `openAI` on Android.
    private func openAI() {
        Task {
            await model.flush()
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
                        .font(.subheadline)
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
                                .font(.body)
                                .foregroundStyle(isSelected ? theme.text : theme.textSecondary)
                            Spacer()
                            if isSelected {
                                Image(systemName: "checkmark")
                                    .font(.caption)
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
