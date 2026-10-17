import SwiftUI

/// The answer's Scripture, summarised as one chip per passage; the full text
/// and the per-passage actions live in a sheet, so a long answer no longer
/// grows by a row per verse (see `Shared/Chat/VersePassages.swift`).
/// Port of `macos/SureWord/Chat/Views/ChatCards.swift`, with the sheet in a
/// navigation stack and detents like the other chat sheets.
struct RetrievedVersesCard: View {
    @Environment(\.theme) private var theme

    let grouped: GroupedVerses
    let strength: MatchStrength?
    /// For the Share sheet the passages open; the answer card's bubble owns it.
    let api: APIClient
    var onCopy: (RetrievedVerse) -> Void
    var onSaveToNote: (RetrievedVerse) -> Void
    var onReadInBible: (RetrievedVerse) -> Void

    @State private var focus: VersesSheetFocus?
    /// Presented over the passages sheet, so sharing does not lose the place.
    @State private var shareCard: ShareCardItem?

    var body: some View {
        let chips = grouped.inlineChips
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Button {
                    focus = VersesSheetFocus(key: "")
                } label: {
                    HStack(spacing: Spacing.sm) {
                        Image(systemName: "book.closed")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(theme.textMuted)
                        Text(grouped.summary)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(theme.textSecondary)
                            .lineLimit(1)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.textFaint)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Scripture in this answer, \(grouped.summary)")

                ChipFlowLayout {
                    ForEach(chips.shown) { passage in
                        PassageReferenceChip(label: passage.reference) {
                            focus = VersesSheetFocus(key: passage.key)
                        }
                    }
                    if chips.hidden > 0 {
                        PassageReferenceChip(label: "+\(chips.hidden) more", isMore: true) {
                            focus = VersesSheetFocus(key: "")
                        }
                    }
                }
            }
        }
        .sheet(item: $focus) { focus in
            NavigationStack {
                VersesSheetContent(
                    grouped: grouped,
                    strength: grouped.searchHits.isEmpty ? nil : strength,
                    focusKey: focus.key,
                    onCopy: { onCopy($0.asRetrievedVerse) },
                    onShare: { shareCard = $0.shareCardItem },
                    // Both hops leave the sheet first, so the toast and the
                    // reader are not hidden behind it.
                    onSaveToNote: { passage in
                        self.focus = nil
                        onSaveToNote(passage.asRetrievedVerse)
                    },
                    onReadInBible: { passage in
                        self.focus = nil
                        onReadInBible(passage.readTarget)
                    }
                )
                .background(theme.bgElevated)
                .navigationTitle("Scripture in this answer")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { self.focus = nil }
                    }
                }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .shareCardSheet(item: $shareCard, api: api)
        }
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

/// The verse the assistant made today's "Pick Up Your Cross", shown under the
/// answer as a preview. Content, not chrome: the receipts line says what
/// happened and owns the tap ("Today's cross: {reference}"), so this card no
/// longer carries a heading, a chevron, or a button of its own. Port of
/// `mobile/src/features/chat/CrossActionCard.tsx`.
struct CrossActionCard: View {
    @Environment(\.theme) private var theme
    let action: CrossAction

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(action.reference)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.text)

            Text(action.text)
                .font(.custom(FontFamily.verse, size: 14))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background(theme.accentSoft, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.accentBorder, lineWidth: 1)
        }
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
