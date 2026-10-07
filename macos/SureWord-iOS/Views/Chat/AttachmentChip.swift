import SwiftUI

/// One attachment chip: image thumbnail or a type glyph, the filename, its size,
/// and an optional remove button. iOS port of
/// `macos/SureWord/Chat/Views/AttachmentCard.swift` — taps open through
/// `openURL` instead of `NSWorkspace`.
///
/// It serves both sides of the flow — the staged draft on the composer (where it
/// has a remove button) and the receipt inside a sent bubble (where it does not) —
/// which is why it takes either the descriptor or the rendered-message form.
struct AttachmentChip: View {
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL

    let filename: String
    let mediaType: String
    let size: Int
    let previewURL: String
    var transcript: String?
    var durationSeconds: Double?
    var onRemove: (() -> Void)?

    /// A voice message opens its transcript in place rather than the file: the
    /// words are what the assistant read, and they are what the user wants to see.
    @State private var showsTranscript = false

    init(attachment: ChatAttachmentDescriptor, onRemove: (() -> Void)? = nil) {
        filename = attachment.filename
        mediaType = attachment.mediaType
        size = attachment.size
        previewURL = attachment.previewUrl
        transcript = attachment.transcript
        durationSeconds = attachment.durationSeconds
        self.onRemove = onRemove
    }

    init(attachment: ChatAttachment, onRemove: (() -> Void)? = nil) {
        filename = attachment.filename
        mediaType = attachment.mediaType
        size = attachment.size
        previewURL = attachment.previewURL
        transcript = attachment.transcript
        durationSeconds = attachment.durationSeconds
        self.onRemove = onRemove
    }

    private var isImage: Bool { mediaType.hasPrefix("image/") }
    private var isAudio: Bool { AttachmentLimits.isAudio(mediaType) }
    private var glyph: String { mediaType == "application/pdf" ? "PDF" : "TXT" }

    /// The transcript, when there is one worth showing. An empty transcript (no
    /// words could be made out) falls back to opening the file, as on the web.
    private var shownTranscript: String? {
        guard isAudio, let transcript, !transcript.isEmpty else { return nil }
        return transcript
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                thumbnail
                VStack(alignment: .leading, spacing: 2) {
                    Text(filename)
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if isAudio {
                        Text(voiceMessageLabel(durationSeconds: durationSeconds))
                            .font(.system(size: 10))
                            .foregroundStyle(theme.textFaint)
                    } else if size > 0 {
                        Text(formatAttachmentBytes(size))
                            .font(.system(size: 10))
                            .foregroundStyle(theme.textFaint)
                    }
                }
                if let onRemove {
                    Button(action: onRemove) {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(theme.textFaint)
                            .frame(width: 28, height: 28)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(filename)")
                }
            }

            if showsTranscript, let shownTranscript {
                Text(shownTranscript)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Spacing.sm)
        .frame(maxWidth: showsTranscript ? 300 : 240, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.borderStrong, lineWidth: 1)
        }
        .contentShape(.rect)
        .onTapGesture {
            if shownTranscript != nil {
                showsTranscript.toggle()
            } else if let url = URL(string: previewURL) {
                openURL(url)
            }
        }
        .accessibilityLabel(shownTranscript != nil ? "Show what was said in \(filename)" : filename)
    }

    @ViewBuilder
    private var thumbnail: some View {
        if isAudio {
            Image(systemName: "mic.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(width: 42, height: 42)
                .background(theme.accentSoft, in: .rect(cornerRadius: Radius.sm))
        } else if isImage, let url = URL(string: previewURL) {
            AsyncImage(url: url) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                Rectangle().fill(theme.surfaceStrong)
            }
            .frame(width: 42, height: 42)
            .clipShape(.rect(cornerRadius: Radius.sm))
        } else {
            Text(glyph)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(theme.accent)
                .frame(width: 42, height: 42)
                .background(theme.accentSoft, in: .rect(cornerRadius: Radius.sm))
        }
    }
}
