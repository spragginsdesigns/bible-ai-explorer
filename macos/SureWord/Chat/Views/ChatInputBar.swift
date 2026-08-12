import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Composer: verse-attachment pill, file attachments, slash-command palette, and
/// the field itself. Port of `mobile/src/features/chat/ChatInputBar.tsx`, with the
/// three Mac intake paths standing in for Android's camera/gallery/document sheet:
/// the file picker, drag-and-drop onto the bar, and ⌘V.
struct ChatInputBar: View {
    @Environment(\.theme) private var theme
    @Bindable var chat: ChatViewModel

    @FocusState private var isFocused: Bool
    @State private var selectedCommandIndex = 0
    @State private var isImporting = false
    @State private var isDropTargeted = false
    @State private var pasteMonitor: Any?

    private var matches: [SlashCommand] {
        SlashCommand.matching(chat.input)
    }

    /// The allowlist as UTTypes, so the picker greys out what the server rejects.
    private var allowedTypes: [UTType] {
        AttachmentLimits.mediaTypes.compactMap { UTType(mimeType: $0) }
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
                    isImporting = true
                } label: {
                    Image(systemName: "paperclip")
                }
                .buttonStyle(SubtleButtonStyle())
                .disabled(chat.uploadingAttachments)
                .help("Attach files (images, PDF, text)")

                TextField("Ask anything…", text: $chat.input, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14))
                    .lineLimit(1...8)
                    .focused($isFocused)
                    .onSubmit(submit)

                if chat.isBusy {
                    Button {
                        chat.stop()
                    } label: {
                        Image(systemName: "stop.fill")
                    }
                    .buttonStyle(SubtleButtonStyle())
                    .help("Stop generating (⌘.)")
                } else {
                    Button(action: submit) {
                        Image(systemName: "arrow.up")
                            .fontWeight(.semibold)
                    }
                    .buttonStyle(AccentButtonStyle())
                    .disabled(!chat.canSend)
                    .help("Send (↩)")
                }
            }
            .padding(Spacing.md)
            .background(theme.glassLight, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(
                        isDropTargeted ? theme.accent
                            : isFocused ? theme.accentBorder
                            : theme.border,
                        lineWidth: isDropTargeted ? 2 : 1
                    )
            }
        }
        .onAppear {
            isFocused = true
            installPasteMonitor()
        }
        .onDisappear(perform: removePasteMonitor)
        .onChange(of: chat.input) { selectedCommandIndex = 0 }
        .fileImporter(
            isPresented: $isImporting,
            allowedContentTypes: allowedTypes,
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls):
                Task { await chat.addAttachments(fileURLs: urls) }
            case .failure:
                // Cancelling is a `.failure` on some macOS versions; either way
                // there is nothing useful to say about a picker that closed.
                break
            }
        }
        // Drag-and-drop straight onto the composer.
        .dropDestination(for: URL.self) { urls, _ in
            let files = urls.filter(\.isFileURL)
            guard !files.isEmpty else { return false }
            Task { await chat.addAttachments(fileURLs: files) }
            return true
        } isTargeted: { isDropTargeted = $0 }
    }

    // MARK: Paste

    /// ⌘V with an image or file on the pasteboard attaches it; anything else falls
    /// through to the text field so ordinary text paste still works.
    ///
    /// A local key monitor rather than `onPasteCommand` because the focused
    /// `TextField` is the first responder and consumes the paste before a SwiftUI
    /// paste modifier upstream of it ever sees the event.
    private func installPasteMonitor() {
        guard pasteMonitor == nil else { return }
        pasteMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard event.modifierFlags.contains(.command),
                  event.charactersIgnoringModifiers?.lowercased() == "v",
                  let files = Self.pasteboardAttachments()
            else { return event }
            Task { await chat.addAttachments(files) }
            return nil
        }
    }

    private func removePasteMonitor() {
        if let pasteMonitor { NSEvent.removeMonitor(pasteMonitor) }
        pasteMonitor = nil
    }

    /// Read attachable content off the general pasteboard: copied files first,
    /// then raw image data (a screenshot, or an image copied from a browser).
    static func pasteboardAttachments() -> [LocalAttachment]? {
        let pasteboard = NSPasteboard.general

        if let urls = pasteboard.readObjects(forClasses: [NSURL.self]) as? [URL] {
            let files = urls.filter(\.isFileURL).compactMap { url -> LocalAttachment? in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? AttachmentValidator.normalize(
                    filename: url.lastPathComponent,
                    declaredMediaType: "",
                    data: data
                )
            }
            if !files.isEmpty { return files }
        }

        // PNG first: a screenshot arrives as both PNG and TIFF, and PNG is on the
        // allowlist while TIFF is not.
        let stamp = Int(Date().timeIntervalSince1970)
        if let png = pasteboard.data(forType: .png) {
            return [LocalAttachment(filename: "clipboard-\(stamp).png", mediaType: "image/png", data: png)]
        }
        if let tiff = pasteboard.data(forType: .tiff),
           let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
            return [LocalAttachment(filename: "clipboard-\(stamp).png", mediaType: "image/png", data: png)]
        }
        return nil
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
            }
            .buttonStyle(SubtleButtonStyle())
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
        HStack(spacing: Spacing.sm) {
            ForEach(chat.fileAttachments) { attachment in
                AttachmentCard(attachment: attachment) {
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

    private func submit() {
        // Completing a command that still needs arguments must not send it —
        // fill the input and let the user finish typing.
        if let first = matches.first, chat.input.hasPrefix("/"), matches.count == 1,
           first.requiresArgs, chat.input.trimmingCharacters(in: .whitespaces) == first.command {
            chat.input = first.command + " "
            return
        }
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
                    .padding(.vertical, Spacing.sm)
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
            Button {
                chat.attachment = nil
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(SubtleButtonStyle())
        }
        .font(.system(size: 11))
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(theme.accentSoft, in: .capsule)
        .overlay { Capsule().strokeBorder(theme.accentBorder, lineWidth: 1) }
    }
}
