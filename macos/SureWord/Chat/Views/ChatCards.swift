import SwiftUI

/// Retrieved-verses card with its match-strength badge.
/// Port of `mobile/src/features/chat/RetrievedVersesCard.tsx`.
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
                    Button {
                        withAnimation(.snappy) { isExpanded.toggle() }
                    } label: {
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.textFaint)
                    }
                    .buttonStyle(SubtleButtonStyle())
                }

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

    @State private var isHovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                Text(verse.reference)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
                Spacer()
                // Actions appear on hover — the Mac equivalent of Android's
                // long-press sheet.
                if isHovering {
                    Button("Copy", action: onCopy)
                    Button("Save to note", action: onSaveToNote)
                    Button("Read in Bible", action: onReadInBible)
                }
            }
            .font(.system(size: 11))
            .buttonStyle(SubtleButtonStyle())

            if let text = verse.text {
                Text(text)
                    .font(.custom(FontFamily.verse, size: 16))
                    .foregroundStyle(theme.textSecondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, Spacing.xs)
        .onHover { isHovering = $0 }
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

/// Follow-up suggestion chips (at most two). Port of `FollowUpChips.tsx`.
struct FollowUpChips: View {
    let followUps: [String]
    var onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: Spacing.sm) {
            ForEach(followUps, id: \.self) { question in
                Button(question) { onSelect(question) }
                    .buttonStyle(AccentButtonStyle())
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
