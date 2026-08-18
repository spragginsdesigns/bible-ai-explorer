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
    var onRemove: (() -> Void)?

    init(attachment: ChatAttachmentDescriptor, onRemove: (() -> Void)? = nil) {
        filename = attachment.filename
        mediaType = attachment.mediaType
        size = attachment.size
        previewURL = attachment.previewUrl
        self.onRemove = onRemove
    }

    init(attachment: ChatAttachment, onRemove: (() -> Void)? = nil) {
        filename = attachment.filename
        mediaType = attachment.mediaType
        size = attachment.size
        previewURL = attachment.previewURL
        self.onRemove = onRemove
    }

    private var isImage: Bool { mediaType.hasPrefix("image/") }
    private var glyph: String { mediaType == "application/pdf" ? "PDF" : "TXT" }

    var body: some View {
        HStack(spacing: Spacing.sm) {
            thumbnail
            VStack(alignment: .leading, spacing: 2) {
                Text(filename)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if size > 0 {
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
        .padding(Spacing.sm)
        .frame(maxWidth: 240, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.borderStrong, lineWidth: 1)
        }
        .contentShape(.rect)
        .onTapGesture {
            if let url = URL(string: previewURL) { openURL(url) }
        }
        .accessibilityLabel(filename)
    }

    @ViewBuilder
    private var thumbnail: some View {
        if isImage, let url = URL(string: previewURL) {
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
