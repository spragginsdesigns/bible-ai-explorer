import AppKit
import SwiftUI

/// One attachment chip: image thumbnail or a type glyph, the filename, its size,
/// and an optional remove button. Port of
/// `mobile/src/features/chat/FileAttachmentCards.tsx`.
///
/// It serves both sides of the flow — the staged draft on the composer (where it
/// has a remove button) and the receipt inside a sent bubble (where it does not) —
/// which is why it takes either the descriptor or the rendered-message form.
struct AttachmentCard: View {
    @Environment(\.theme) private var theme
    /// For the preview refresh; every chat surface that draws a card has it.
    @Environment(AppModel.self) private var app

    /// The attachment id, which a fresh preview URL is minted for.
    let id: String
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
    /// The last preview URL minted for this chip (`AttachmentPreviewRefresh`):
    /// a presigned one lasts 15 minutes, so an older conversation needs a new one.
    @State private var refreshedURL: String?
    /// One re-mint per chip when its thumbnail fails, so an image that is truly
    /// gone does not ask forever.
    @State private var didRetryPreview = false

    init(attachment: ChatAttachmentDescriptor, onRemove: (() -> Void)? = nil) {
        id = attachment.id
        filename = attachment.filename
        mediaType = attachment.mediaType
        size = attachment.size
        previewURL = attachment.previewUrl
        transcript = attachment.transcript
        durationSeconds = attachment.durationSeconds
        self.onRemove = onRemove
    }

    init(attachment: ChatAttachment, onRemove: (() -> Void)? = nil) {
        id = attachment.id
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
                        .appFont(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(theme.text)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if isAudio {
                        Text(voiceMessageLabel(durationSeconds: durationSeconds))
                            .appFont(.system(size: 10))
                            .foregroundStyle(theme.textFaint)
                    } else if size > 0 {
                        Text(formatAttachmentBytes(size))
                            .appFont(.system(size: 10))
                            .foregroundStyle(theme.textFaint)
                    }
                }
                if let onRemove {
                    Button(action: onRemove) {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(SubtleButtonStyle())
                    .help("Remove \(filename)")
                }
            }

            if showsTranscript, let shownTranscript {
                Text(shownTranscript)
                    .appFont(.system(size: 12.5))
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Spacing.sm)
        .frame(maxWidth: showsTranscript ? 420 : 240, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.borderStrong, lineWidth: 1)
        }
        .contentShape(.rect)
        .onTapGesture {
            if shownTranscript != nil {
                showsTranscript.toggle()
            } else {
                openFile()
            }
        }
        .help(shownTranscript != nil ? "Show what was said in \(filename)" : filename)
    }

    private func retryPreview() async {
        guard !didRetryPreview else { return }
        didRetryPreview = true
        if let fresh = await AttachmentPreviewRefresh.freshURL(for: id, api: app.api) {
            refreshedURL = fresh
        }
    }

    /// Re-mint before every open, as Android does, so the file opens even
    /// when the message is hours old.
    private func openFile() {
        Task {
            let fresh = await AttachmentPreviewRefresh.freshURL(for: id, api: app.api)
            if let fresh { refreshedURL = fresh }
            guard let url = AttachmentPreviewRefresh.openTarget(fresh: fresh, refreshed: refreshedURL, original: previewURL) else { return }
            NSWorkspace.shared.open(url)
        }
    }

    @ViewBuilder
    private var thumbnail: some View {
        if isAudio {
            Image(systemName: "mic.fill")
                .appFont(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(width: 42, height: 42)
                .background(theme.accentSoft, in: .rect(cornerRadius: Radius.sm))
        } else if isImage, let url = URL(string: refreshedURL ?? previewURL) {
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable().aspectRatio(contentMode: .fill)
                } else {
                    Rectangle().fill(theme.surfaceStrong)
                        // Android's `onError` refresh: an expired link is
                        // re-minted, and the new URL reloads the image.
                        .task(id: phase.error != nil) {
                            if phase.error != nil { await retryPreview() }
                        }
                }
            }
            .frame(width: 42, height: 42)
            .clipShape(.rect(cornerRadius: Radius.sm))
        } else {
            Text(glyph)
                .appFont(.system(size: 10, weight: .bold))
                .foregroundStyle(theme.accent)
                .frame(width: 42, height: 42)
                .background(theme.accentSoft, in: .rect(cornerRadius: Radius.sm))
        }
    }
}
