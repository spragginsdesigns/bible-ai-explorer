import SwiftUI

/// The note editor — a port of `mobile/app/(app)/notes/[id].tsx`.
///
/// Top bar (title, saving state, pin, tags, AI), formatting toolbar, the rich
/// text view, and the per-note AI conversation. Android presents the AI as a
/// slide-up sheet because a phone has one column; here it is a trailing
/// inspector, which is the same thing with room to type beside it.
struct NoteEditorPane: View {
    @Environment(\.theme) private var theme

    let noteID: String
    let api: APIClient
    @Bindable var library: NotesLibraryModel

    @State private var model: NoteEditorModel
    @State private var ai: NoteAIModel
    @State private var isAIOpen = false
    @State private var isTagPopoverPresented = false
    @State private var draftTitle = ""
    @State private var linkTarget = ""
    @State private var isLinkPopoverPresented = false

    init(noteID: String, api: APIClient, library: NotesLibraryModel) {
        self.noteID = noteID
        self.api = api
        self.library = library
        _model = State(initialValue: NoteEditorModel(noteID: noteID, api: NotesAPI(api: api)))
        _ai = State(initialValue: NoteAIModel(noteID: noteID, api: api))
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                topBar
                Divider().overlay(theme.border)
                NoteFormattingToolbar(controller: model.controller) {
                    linkTarget = ""
                    isLinkPopoverPresented = true
                }
                .popover(isPresented: $isLinkPopoverPresented) { linkPopover }
                Divider().overlay(theme.border)

                if model.isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    NoteEditorTextView(controller: model.controller)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }

            if isAIOpen {
                Divider().overlay(theme.border)
                NoteAIPanelView(ai: ai) { isAIOpen = false }
                    .frame(width: 380)
            }
        }
        .task {
            model.start()
            ai.onNoteAppended = { event in
                guard event.noteID == noteID else { return }
                Task { await model.reloadAfterAIAppend() }
            }
        }
        .onChange(of: model.note?.title) { _, title in
            draftTitle = title ?? ""
        }
        .onDisappear {
            // Last-chance write: the pane can go away between the debounce
            // firing and the PATCH landing.
            let model = model
            Task { await model.flush() }
        }
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: Spacing.sm) {
            VStack(alignment: .leading, spacing: 0) {
                TextField("Untitled Note", text: $draftTitle)
                    .textFieldStyle(.plain)
                    .font(.system(size: 16, weight: .semibold))
                    .onSubmit(commitTitle)
                    .onAppear { draftTitle = model.note?.title ?? "" }

                if model.isSaving {
                    Text("Saving…")
                        .font(.system(size: 10))
                        .foregroundStyle(theme.textGhost)
                } else if let error = model.error {
                    Text(error)
                        .font(.system(size: 10))
                        .foregroundStyle(theme.danger)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: Spacing.md)

            Button {
                Task { await model.togglePin() }
            } label: {
                Image(systemName: model.note?.isPinned == true ? "pin.fill" : "pin")
                    .foregroundStyle(model.note?.isPinned == true ? theme.accent : theme.textMuted)
            }
            .buttonStyle(SubtleButtonStyle())
            .help(model.note?.isPinned == true ? "Unpin note" : "Pin note")

            Button {
                isTagPopoverPresented = true
            } label: {
                Image(systemName: "tag")
                    .foregroundStyle(
                        (model.note?.tagIds.isEmpty == false) ? theme.accent : theme.textMuted
                    )
            }
            .buttonStyle(SubtleButtonStyle())
            .help("Tags")
            .popover(isPresented: $isTagPopoverPresented, arrowEdge: .bottom) {
                NoteTagPopover(model: model)
            }

            Menu {
                Button("No Folder") { Task { await model.move(toFolder: nil) } }
                ForEach(library.folders) { folder in
                    Button(folder.name) { Task { await model.move(toFolder: folder.id) } }
                }
                Divider()
                Button("Delete Note", role: .destructive) {
                    Task {
                        await model.delete()
                        library.selectedNoteID = nil
                    }
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Note actions")

            Button {
                toggleAI()
            } label: {
                Image(systemName: "sparkles")
                    .foregroundStyle(isAIOpen ? theme.accent : theme.textMuted)
            }
            .buttonStyle(SubtleButtonStyle())
            .help("AI assistant")
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
    }

    private var linkPopover: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Link").font(.system(size: 12, weight: .semibold))
            TextField("https://…", text: $linkTarget)
                .textFieldStyle(.roundedBorder)
                .frame(width: 240)
                .onSubmit {
                    model.controller.setLink(linkTarget)
                    isLinkPopoverPresented = false
                }
            HStack {
                Button("Remove") {
                    model.controller.setLink(nil)
                    isLinkPopoverPresented = false
                }
                Spacer()
                Button("Apply") {
                    model.controller.setLink(linkTarget)
                    isLinkPopoverPresented = false
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(Spacing.lg)
    }

    private func commitTitle() {
        let trimmed = draftTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != model.note?.title else { return }
        Task { await model.rename(to: draftTitle) }
    }

    /// Save before opening the panel so the assistant reads the current text,
    /// not the last autosave — the same ordering as `openAI` on Android.
    private func toggleAI() {
        if isAIOpen {
            isAIOpen = false
            return
        }
        Task {
            await model.flush()
            isAIOpen = true
            await ai.loadHistory()
        }
    }
}

// MARK: - Tags

/// Tag picker for the open note — a port of `NoteTagSheet.tsx`.
struct NoteTagPopover: View {
    @Environment(\.theme) private var theme
    @Bindable var model: NoteEditorModel

    @State private var isCreating = false
    @State private var name = ""
    @State private var color = TagPalette.colors[0]

    private var tags: [Tag] { NotesStore.shared.tags }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Tags")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.textMuted)

            if tags.isEmpty, !isCreating {
                Text("No tags yet.")
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textGhost)
            }

            ForEach(tags) { tag in
                let isSelected = model.note?.tagIds.contains(tag.id) == true
                Button {
                    Task { await model.toggleTag(id: tag.id) }
                } label: {
                    HStack(spacing: Spacing.sm) {
                        Circle()
                            .fill(isSelected ? Color(hexString: tag.color) : .clear)
                            .frame(width: 11, height: 11)
                            .overlay {
                                Circle().strokeBorder(Color(hexString: tag.color), lineWidth: 1.5)
                            }
                        Text(tag.name)
                            .font(.system(size: 13))
                            .foregroundStyle(isSelected ? theme.text : theme.textSecondary)
                        Spacer()
                        if isSelected {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10))
                                .foregroundStyle(theme.accent)
                        }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }

            Divider().overlay(theme.border)

            if isCreating {
                TextField("Tag name", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(create)
                HStack(spacing: 6) {
                    ForEach(TagPalette.colors, id: \.self) { preset in
                        Button {
                            color = preset
                        } label: {
                            Circle()
                                .fill(Color(hexString: preset))
                                .frame(width: 20, height: 20)
                                .overlay {
                                    Circle().strokeBorder(
                                        color == preset ? theme.text : .clear,
                                        lineWidth: 2
                                    )
                                }
                        }
                        .buttonStyle(.plain)
                    }
                }
                HStack {
                    Button("Create", action: create)
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Cancel") { reset() }
                }
                .font(.system(size: 12))
            } else {
                Button {
                    isCreating = true
                } label: {
                    Label("New tag", systemImage: "plus")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(Spacing.lg)
        .frame(width: 240)
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
