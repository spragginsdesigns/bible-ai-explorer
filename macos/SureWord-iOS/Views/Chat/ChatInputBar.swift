import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Composer: verse-attachment pill, file attachments, slash-command palette,
/// and the field itself. iOS port of
/// `macos/SureWord/Chat/Views/ChatInputBar.swift` (and of
/// `mobile/src/features/chat/ChatInputBar.tsx` before it): the Mac's file
/// picker / drop / ⌘V become Android's source sheet - camera, photo library,
/// files and paste.
struct ChatInputBar: View {
    @Environment(\.theme) private var theme
    @Bindable var chat: ChatViewModel

    @FocusState private var isFocused: Bool
    @State private var isSourceSheetPresented = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var isPhotoPickerPresented = false
    @State private var isFileImporterPresented = false
    @State private var isCameraPresented = false
    /// The source picked in the sheet, acted on once the sheet has finished
    /// dismissing - presenting over a dismissing sheet drops the second
    /// presentation.
    @State private var pendingSource: AttachmentSourceOption?

    /// Android's `locked`: generating, uploading (or creating the
    /// conversation). The palette hides, the field and the attach button
    /// disable. History loading/failed is deliberately left out - iOS lets
    /// `/new` escape a conversation whose history did not load.
    private var isLocked: Bool {
        chat.isBusy || chat.uploadingAttachments || chat.isCreatingConversation
    }

    private var matches: [SlashCommand] {
        isLocked ? [] : SlashCommand.matching(chat.input)
    }

    /// The allowlist as UTTypes, so the picker greys out what the server rejects.
    private var allowedTypes: [UTType] {
        AttachmentLimits.contentTypes
    }

    private var sourceOptions: [AttachmentSourceOption] {
        AttachmentSourceOption.available(hasCamera: UIImagePickerController.isSourceTypeAvailable(.camera))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if chat.isEditing {
                EditingMessageBar { chat.cancelEdit() }
                    // The text is already in the field; put the cursor there.
                    .onAppear { isFocused = true }
            }

            if !matches.isEmpty {
                commandPalette
            }

            if let attachment = chat.attachment {
                attachmentPill(attachment)
            }

            if let message = chat.attachmentError {
                attachmentErrorBanner(message)
            }

            if !chat.fileAttachments.isEmpty || chat.uploadingAttachments {
                filePills
            }

            HStack(alignment: .bottom, spacing: Spacing.sm) {
                Button {
                    chat.clearAttachmentError()
                    isFocused = false
                    isSourceSheetPresented = true
                } label: {
                    Group {
                        if chat.uploadingAttachments {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "plus")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(theme.textMuted)
                        }
                    }
                    .frame(width: 36, height: 36)
                    .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .disabled(isLocked)
                .opacity(isLocked && !chat.uploadingAttachments ? 0.35 : 1)
                .accessibilityLabel("Add an attachment")

                TextField("Ask a question about the Bible...", text: $chat.input, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15))
                    .lineLimit(1...8)
                    .focused($isFocused)
                    .disabled(isLocked)
                    .onSubmit(submit)

                if chat.isBusy {
                    Button {
                        chat.stop()
                    } label: {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(theme.danger)
                            .frame(width: 36, height: 36)
                            .background(theme.dangerSoft, in: .circle)
                            .overlay { Circle().strokeBorder(theme.dangerBorder, lineWidth: 1) }
                            .contentShape(.circle)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Stop generating")
                } else {
                    Button(action: submit) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(chat.canSend ? theme.bg : theme.textGhost)
                            .frame(width: 36, height: 36)
                            .background(
                                chat.canSend ? theme.accent : theme.surfaceStrong,
                                in: .circle
                            )
                            .contentShape(.circle)
                    }
                    .buttonStyle(.plain)
                    .disabled(!chat.canSend)
                    .accessibilityLabel("Send")
                }
            }
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, Spacing.xs)
            .background(theme.glassLight, in: .rect(cornerRadius: Radius.xl))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.xl)
                    .strokeBorder(isFocused ? theme.accentBorder : theme.border, lineWidth: 1)
            }
        }
        .sheet(isPresented: $isSourceSheetPresented, onDismiss: presentPendingSource) {
            AttachmentSourceSheet(options: sourceOptions) { option in
                pendingSource = option
                isSourceSheetPresented = false
            }
        }
        .photosPicker(
            isPresented: $isPhotoPickerPresented,
            selection: $photoSelection,
            maxSelectionCount: AttachmentLimits.pickerSelectionLimit(staged: chat.fileAttachments.count),
            matching: .images
        )
        .onChange(of: photoSelection) { _, items in
            guard !items.isEmpty else { return }
            photoSelection = []
            Task { await attachPickedPhotos(items) }
        }
        .fileImporter(
            isPresented: $isFileImporterPresented,
            allowedContentTypes: allowedTypes,
            allowsMultipleSelection: true
        ) { result in
            if case .success(let urls) = result {
                Task { await chat.addAttachments(fileURLs: urls) }
            }
            // Cancelling is a `.failure` on some OS versions; either way there
            // is nothing useful to say about a picker that closed.
        }
        .fullScreenCover(isPresented: $isCameraPresented) {
            CameraPicker { attachment in
                isCameraPresented = false
                if let attachment {
                    Task { await chat.addAttachments([attachment]) }
                }
            }
            .ignoresSafeArea()
        }
    }

    // MARK: Sources

    /// The sheet has fully dismissed; now act on the source it chose.
    private func presentPendingSource() {
        guard let source = pendingSource else { return }
        pendingSource = nil
        switch source {
        case .camera:
            if let problem = CameraAccess.problem() {
                chat.reportAttachmentError(problem)
            } else {
                isCameraPresented = true
            }
        case .photoLibrary:
            isPhotoPickerPresented = true
        case .files:
            isFileImporterPresented = true
        case .paste:
            let images = ClipboardAttachments.images()
            if images.isEmpty {
                chat.reportAttachmentError(ClipboardAttachments.noImageMessage)
            } else {
                Task { await chat.addAttachments(images) }
            }
        }
    }

    /// Load each picked photo in order, name it for its place in the batch,
    /// and say so when one could not be used - a photo that silently vanished
    /// from the pick was the old behaviour.
    private func attachPickedPhotos(_ items: [PhotosPickerItem]) async {
        let stamp = PastedImages.timestamp()
        var files: [LocalAttachment] = []
        var problem: String?
        for item in items {
            do {
                guard let photo = try await item.loadTransferable(type: PickedPhoto.self) else {
                    problem = problem ?? AttachmentValidator.unsupported("that photo")
                    continue
                }
                let named = photo.named(index: files.count, timestamp: stamp)
                // The same per-file checks a file from disk gets, so an
                // oversized photo is refused with Android's wording.
                files.append(try AttachmentValidator.normalize(
                    filename: named.filename,
                    declaredMediaType: named.mediaType,
                    data: named.data
                ))
            } catch let error as AttachmentError {
                problem = problem ?? error.message
            } catch {
                problem = problem ?? "Could not open the photo library."
            }
        }
        await chat.addAttachments(files)
        if let problem { chat.reportAttachmentError(problem) }
    }

    // MARK: Attachment views

    private func attachmentErrorBanner(_ message: String) -> some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(theme.danger)
            Text(message)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button {
                chat.clearAttachmentError()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.textFaint)
                    .frame(width: 24, height: 24)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
        .font(.system(size: 11))
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(theme.dangerSoft, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.dangerBorder, lineWidth: 1)
        }
    }

    private var filePills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                ForEach(chat.fileAttachments) { attachment in
                    AttachmentChip(attachment: attachment) {
                        Task { await chat.removeAttachment(attachment.id) }
                    }
                }
                if chat.uploadingAttachments {
                    HStack(spacing: Spacing.sm) {
                        ProgressView().controlSize(.small)
                        // Android's uploading labels, and its /verify steps.
                        Text(chat.videoStatus ?? (chat.transcribingVoiceMessage
                            ? "Uploading and transcribing the voice message..."
                            : "Uploading..."))
                            .font(.system(size: 11))
                            .foregroundStyle(theme.textMuted)
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    /// `ChatViewModel.send()` owns the command rules (a command that needs an
    /// argument waits for one, aliases become their canonical command), so a
    /// submit is just a send.
    private func submit() {
        guard !isLocked else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task { await chat.send() }
    }

    private var commandPalette: some View {
        // Android caps the palette at 264pt and scrolls the rest, so a bare
        // "/" (thirteen commands) never shoves the conversation off screen.
        // `ViewThatFits` keeps a short list at its natural height.
        ViewThatFits(in: .vertical) {
            paletteRows
            ScrollView { paletteRows }
                .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxHeight: Self.paletteMaxHeight)
        .background(theme.glass, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.border, lineWidth: 1)
        }
    }

    /// Android's `paletteScroll.maxHeight`.
    static let paletteMaxHeight: CGFloat = 264

    private var paletteRows: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(matches) { command in
                Button {
                    // Same rule as web and Android: a command with an argument
                    // hint fills the input so the user can add to it (or attach).
                    let fills = command.requiresArgs || command.hint != nil
                    chat.input = fills ? "\(command.command) " : command.command
                    if !fills { Task { await chat.send() } }
                } label: {
                    HStack(spacing: Spacing.sm) {
                        Text(command.command)
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                            .foregroundStyle(theme.accent)
                        if let hint = command.hint {
                            Text(hint)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(theme.textGhost)
                                .lineLimit(1)
                        }
                        Text(command.description)
                            .font(.system(size: 11))
                            .foregroundStyle(theme.textMuted)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.md)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func attachmentPill(_ attachment: VerseAttachment) -> some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "text.quote").foregroundStyle(theme.accent)
            Text(attachment.reference)
                .fontWeight(.medium)
                .foregroundStyle(theme.text)
            Text(attachment.translation.label)
                .foregroundStyle(theme.textGhost)
            Spacer(minLength: 0)
            Button {
                chat.attachment = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.textFaint)
                    .frame(width: 24, height: 24)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove attachment")
        }
        .font(.system(size: 11))
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(theme.accentSoft, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.accentBorder, lineWidth: 1)
        }
    }
}
