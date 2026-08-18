import SwiftUI

/// Retrieved-verses card with its match-strength badge.
/// Port of `macos/SureWord/Chat/Views/ChatCards.swift`, re-idiomed for touch:
/// the Mac's hover actions become a tap (read in Bible) plus a context menu.
struct RetrievedVersesCard: View {
    static let initiallyExpanded = false

    @Environment(\.theme) private var theme

    let verses: [RetrievedVerse]
    let strength: MatchStrength?
    var onCopy: (RetrievedVerse) -> Void
    var onSaveToNote: (RetrievedVerse) -> Void
    var onReadInBible: (RetrievedVerse) -> Void

    @State private var isExpanded = RetrievedVersesCard.initiallyExpanded

    private var badgeColor: Color {
        switch strength {
        case .strong: theme.accent
        case .moderate: theme.accentDim
        case .broad, nil: theme.textFaint
        }
    }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Button {
                    withAnimation(.snappy) { isExpanded.toggle() }
                } label: {
                    HStack {
                        Label("Retrieved verses", systemImage: "book.closed")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(theme.textMuted)
                        Spacer()
                        if let strength {
                            Text(strength.label)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(badgeColor)
                                .padding(.horizontal, Spacing.sm)
                                .padding(.vertical, 3)
                                .background(badgeColor.opacity(0.12), in: .capsule)
                        }
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.textFaint)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)

                if isExpanded {
                    ForEach(verses) { verse in
                        VerseRow(
                            verse: verse,
                            onCopy: { onCopy(verse) },
                            onSaveToNote: { onSaveToNote(verse) },
                            onReadInBible: { onReadInBible(verse) }
                        )
                    }
                }
            }
        }
    }
}

private struct VerseRow: View {
    @Environment(\.theme) private var theme

    let verse: RetrievedVerse
    var onCopy: () -> Void
    var onSaveToNote: () -> Void
    var onReadInBible: () -> Void

    var body: some View {
        // Tap opens the reader (Lane 2's hook); long-press is the Android
        // action sheet, as a native context menu.
        Button(action: onReadInBible) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(spacing: Spacing.sm) {
                    Text(verse.reference)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.accent)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(theme.textGhost)
                }

                if let text = verse.text {
                    Text(text)
                        .font(.custom(FontFamily.verse, size: 16))
                        .foregroundStyle(theme.textSecondary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.vertical, Spacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(action: onReadInBible) {
                Label("Read in Bible", systemImage: "book.closed")
            }
            Button(action: onCopy) {
                Label("Copy", systemImage: "doc.on.doc")
            }
            Button(action: onSaveToNote) {
                Label("Save to note", systemImage: "square.and.pencil")
            }
        }
        .accessibilityLabel("\(verse.reference), read in Bible")
    }
}

/// Tavily web-results card. Port of `WebResultsCard.tsx`.
struct WebResultsCard: View {
    @Environment(\.theme) private var theme
    let results: [TavilyResult]

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Label("From the web", systemImage: "globe")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.textMuted)

                ForEach(results) { result in
                    Link(destination: URL(string: result.url) ?? Config.apiURL) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(result.title)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(theme.accent)
                            Text(result.content)
                                .font(.system(size: 11))
                                .foregroundStyle(theme.textMuted)
                                .lineLimit(3)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// Receipt shown after the model writes to a note. Port of `NoteActionCard.tsx`.
struct NoteActionCard: View {
    @Environment(\.theme) private var theme
    let action: NoteAction
    var onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: Spacing.sm) {
                Image(systemName: action.created ? "square.and.pencil" : "text.append")
                    .foregroundStyle(theme.accent)
                Text(action.created ? "Created note" : "Added to note")
                    .foregroundStyle(theme.textMuted)
                Text(action.noteTitle)
                    .foregroundStyle(theme.text)
                    .fontWeight(.medium)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(theme.textGhost)
            }
            .font(.system(size: 12))
            .padding(Spacing.md)
            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(theme.border, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
    }
}

/// "Pick Up Your Cross updated" receipt, shown when the assistant replaced
/// today's guided day. Opens the day it just prepared. Port of
/// `mobile/src/features/chat/CrossActionCard.tsx`.
struct CrossActionCard: View {
    @Environment(\.theme) private var theme
    let action: CrossAction
    var onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(spacing: 6) {
                    Image(systemName: "cross")
                    Text("Pick Up Your Cross updated")
                        .fontWeight(.semibold)
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(theme.textGhost)
                }
                .font(.system(size: 12))
                .foregroundStyle(theme.accent)

                HStack(spacing: 6) {
                    Text(action.reference)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.text)
                    if let previous = action.previousReference {
                        Text("· replaced \(previous)")
                            .font(.system(size: 12))
                            .foregroundStyle(theme.textFaint)
                    }
                }

                Text(action.text)
                    .font(.custom(FontFamily.verse, size: 14))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
            .background(theme.accentSoft, in: .rect(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(theme.accentBorder, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open today's Pick Up Your Cross")
    }
}

/// Follow-up suggestion chips (at most two). Port of `FollowUpChips.tsx`.
/// Chips wrap onto extra lines on a phone instead of clipping.
struct FollowUpChips: View {
    let followUps: [String]
    var onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ForEach(followUps, id: \.self) { question in
                Button(question) { onSelect(question) }
                    .buttonStyle(AccentButtonStyle())
                    .multilineTextAlignment(.leading)
            }
        }
    }
}

/// Animated three-dot indicator shown while waiting on the model.
struct TypingDots: View {
    @Environment(\.theme) private var theme
    @State private var phase = 0.0

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(theme.textFaint)
                    .frame(width: 5, height: 5)
                    .opacity(0.35 + 0.65 * pulse(index))
            }
        }
        .task {
            // A plain repeating animation drives all three dots identically;
            // stepping a shared phase keeps them staggered.
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(180))
                phase += 1
            }
        }
    }

    private func pulse(_ index: Int) -> Double {
        Int(phase) % 3 == index ? 1 : 0
    }
}
