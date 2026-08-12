import SwiftUI

/// Composer: verse-attachment pill, slash-command palette, and the field itself.
/// Port of `mobile/src/features/chat/ChatInputBar.tsx`.
struct ChatInputBar: View {
    @Environment(\.theme) private var theme
    @Bindable var chat: ChatViewModel

    @FocusState private var isFocused: Bool
    @State private var selectedCommandIndex = 0

    private var matches: [SlashCommand] {
        SlashCommand.matching(chat.input)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if !matches.isEmpty {
                commandPalette
            }

            if let attachment = chat.attachment {
                attachmentPill(attachment)
            }

            HStack(alignment: .bottom, spacing: Spacing.sm) {
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
                    .strokeBorder(isFocused ? theme.accentBorder : theme.border, lineWidth: 1)
            }
        }
        .onAppear { isFocused = true }
        .onChange(of: chat.input) { selectedCommandIndex = 0 }
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
