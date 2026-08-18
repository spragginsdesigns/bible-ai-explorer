import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Composer: verse-attachment pill, file attachments, slash-command palette,
/// and the field itself. iOS port of
/// `macos/SureWord/Chat/Views/ChatInputBar.swift` (and of
/// `mobile/src/features/chat/ChatInputBar.tsx` before it): the Mac's file
/// picker / drop / ⌘V become a source dialog with Photos, Camera, Files and
/// Paste.
struct ChatInputBar: View {
    @Environment(\.theme) private var theme
    @Bindable var chat: ChatViewModel

    @FocusState private var isFocused: Bool
    @State private var isSourceDialogPresented = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var isPhotoPickerPresented = false
    @State private var isFileImporterPresented = false
    @State private var isCameraPresented = false
    /// The source picked in the dialog, presented once the dialog has finished
    /// dismissing — presenting over a dismissing confirmation dialog drops the
    /// second presentation.
    @State private var pendingSource: AttachmentSource?

    private enum AttachmentSource {
        case photoLibrary, camera, files
    }

    private var matches: [SlashCommand] {
        SlashCommand.matching(chat.input)
    }

    /// The allowlist as UTTypes, so the picker greys out what the server rejects.
    private var allowedTypes: [UTType] {
        AttachmentLimits.mediaTypes.compactMap { UTType(mimeType: $0) }
    }

    /// Presenting over a dismissing confirmation dialog drops the second
    /// presentation, so the chosen source is staged and presented from the
    /// dialog's dismissal (`onChange` below) rather than on a timer.
    private func presentAfterDialog(_ source: AttachmentSource) {
        pendingSource = source
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
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
                    isSourceDialogPresented = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(theme.textMuted)
                        .frame(width: 36, height: 36)
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .disabled(chat.uploadingAttachments)
                .accessibilityLabel("Attach photos or files")

                TextField("Ask anything…", text: $chat.input, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15))
                    .lineLimit(1...8)
                    .focused($isFocused)
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
        .confirmationDialog(
            "Add to your message",
            isPresented: $isSourceDialogPresented,
            titleVisibility: .visible
        ) {
            Button {
                presentAfterDialog(.photoLibrary)
            } label: {
                Label("Photo Library", systemImage: "photo.on.rectangle")
            }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button {
                    presentAfterDialog(.camera)
                } label: {
                    Label("Take Photo", systemImage: "camera")
                }
            }
            Button {
                presentAfterDialog(.files)
            } label: {
                Label("Choose File", systemImage: "doc")
            }
            if ClipboardAttachments.hasImage {
                Button {
                    if let image = ClipboardAttachments.image() {
                        Task { await chat.addAttachments([image]) }
                    }
                } label: {
                    Label("Paste Image", systemImage: "doc.on.clipboard")
                }
            }
        } message: {
            Text("Photos, screenshots, documents, and text files")
        }
        // The dialog has fully dismissed; now present the source it chose.
        .onChange(of: isSourceDialogPresented) { _, isPresented in
            guard !isPresented, let source = pendingSource else { return }
            pendingSource = nil
            switch source {
            case .photoLibrary: isPhotoPickerPresented = true
            case .camera: isCameraPresented = true
            case .files: isFileImporterPresented = true
            }
        }
        .photosPicker(
            isPresented: $isPhotoPickerPresented,
            selection: $photoSelection,
            maxSelectionCount: AttachmentLimits.maxPerMessage,
            matching: .images
        )
        .onChange(of: photoSelection) { _, items in
            guard !items.isEmpty else { return }
            photoSelection = []
            Task {
                var files: [LocalAttachment] = []
                for item in items {
                    if let photo = try? await item.loadTransferable(type: PickedPhoto.self) {
                        files.append(photo.attachment)
                    }
                }
                await chat.addAttachments(files)
            }
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
                        Text("Uploading…")
                            .font(.system(size: 11))
                            .foregroundStyle(theme.textMuted)
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                }
            }
        }
    }

    private func submit() {
        // Completing a command that still needs arguments must not send it —
        // fill the input and let the user finish typing.
        if let first = matches.first, chat.input.hasPrefix("/"), matches.count == 1,
           first.requiresArgs, chat.input.trimmingCharacters(in: .whitespaces) == first.command {
            chat.input = first.command + " "
            return
        }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task { await chat.send() }
    }

    private var commandPalette: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(matches) { command in
                Button {
                    chat.input = command.requiresArgs ? "\(command.command) " : command.command
                    if !command.requiresArgs { Task { await chat.send() } }
                } label: {
                    HStack(spacing: Spacing.sm) {
                        Text(command.command)
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                            .foregroundStyle(theme.accent)
                        if let hint = command.hint {
                            Text(hint)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(theme.textGhost)
                        }
                        Text(command.description)
                            .font(.system(size: 11))
                            .foregroundStyle(theme.textMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.md)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .background(theme.glass, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.border, lineWidth: 1)
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
