import AVFoundation
import SwiftUI
import UIKit

/// Where an attachment comes from - Android's `AttachmentSourceSheet` options,
/// in its order.
enum AttachmentSourceOption: String, CaseIterable, Identifiable, Sendable {
    case camera, photoLibrary, files, paste

    var id: Self { self }

    /// Android's labels and detail lines, word for word.
    var label: String {
        switch self {
        case .camera: "Take a photo"
        case .photoLibrary: "Photo library"
        case .files: "Choose files"
        case .paste: "Paste screenshot"
        }
    }

    var detail: String {
        switch self {
        case .camera: "Use your camera"
        case .photoLibrary: "Choose one or more images"
        case .files: "PDF, text, CSV, JSON, or a voice message"
        case .paste: "Use the image on your clipboard"
        }
    }

    var systemImage: String {
        switch self {
        case .camera: "camera"
        case .photoLibrary: "photo.on.rectangle"
        case .files: "doc.badge.plus"
        case .paste: "doc.on.clipboard"
        }
    }

    /// The options a device offers. Android always lists the camera; a device
    /// with no camera (the simulator, some iPads) cannot open one at all, so it
    /// is left out rather than shown as a dead row.
    static func available(hasCamera: Bool) -> [AttachmentSourceOption] {
        allCases.filter { $0 != .camera || hasCamera }
    }
}

/// Camera access, checked before the picker opens so a refusal is explained
/// with Android's copy instead of a black viewfinder.
enum CameraAccess {
    static let deniedMessage = "Camera permission is required to take a photo."

    /// Nil when the camera may open (or the system is about to ask), else the
    /// message to show.
    static func problem(
        status: AVAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    ) -> String? {
        switch status {
        case .denied, .restricted: deniedMessage
        default: nil
        }
    }
}

/// The "Add to your message" sheet - Android's bottom sheet with its eyebrow,
/// title, subtitle and one row per source.
struct AttachmentSourceSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    let options: [AttachmentSourceOption]
    var onSelect: (AttachmentSourceOption) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("ADD TO YOUR MESSAGE")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.2)
                        .foregroundStyle(theme.accent)
                    Text("Choose an attachment")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(theme.text)
                    Text("Photos, screenshots, documents, and text files")
                        .font(.system(size: 13))
                        .foregroundStyle(theme.textMuted)
                }
                Spacer(minLength: 0)
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(theme.textMuted)
                        .frame(width: 36, height: 36)
                        .background(theme.surface, in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close attachment menu")
            }

            VStack(spacing: Spacing.sm) {
                ForEach(options) { option in
                    Button {
                        onSelect(option)
                    } label: {
                        HStack(spacing: Spacing.md) {
                            Image(systemName: option.systemImage)
                                .font(.system(size: 18))
                                .foregroundStyle(theme.accent)
                                .frame(width: 40, height: 40)
                                .background(theme.accentSoft, in: .rect(cornerRadius: Radius.md))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(option.label)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(theme.text)
                                Text(option.detail)
                                    .font(.system(size: 12))
                                    .foregroundStyle(theme.textMuted)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(theme.textGhost)
                        }
                        .padding(Spacing.md)
                        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(option.label)
                    .accessibilityHint(option.detail)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.lg)
        .padding(.top, Spacing.sm)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}
