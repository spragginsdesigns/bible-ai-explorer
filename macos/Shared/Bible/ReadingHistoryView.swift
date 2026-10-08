import SwiftUI

/// The Reading log, mirroring Android `mobile/app/(app)/bible/history.tsx`.
/// Copy is Android's verbatim; the sheet keeps a native Done button in place
/// of Android's "‹ Bible" back link.
struct ReadingHistoryView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: ReadingJournal
    var onOpen: (ReadingJournalEntry) -> Void
    /// "Talk to SureWord →"; hidden where the host has no chat route.
    var onTalk: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack {
                Text("Reading log").font(.title2.bold()).foregroundStyle(theme.text)
                Spacer()
                Button("Done") { dismiss() }
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    intro.padding(.bottom, Spacing.lg)
                    let entries = model.history
                    ForEach(Array(entries.enumerated()), id: \.element.eventId) { index, entry in
                        if index == 0 || entries[index - 1].sessionId != entry.sessionId {
                            Text(entry.timeLabel).font(.caption).foregroundStyle(theme.textMuted)
                                .padding(.top, Spacing.md).padding(.bottom, Spacing.xs)
                        }
                        row(entry)
                    }
                    if entries.isEmpty && !model.loadingHistory && model.historyError == nil {
                        bodyText("No readings yet. Start with a chapter, or tell SureWord what you read in your physical Bible.")
                    }
                    footer.padding(.top, Spacing.lg)
                }
            }
        }
        .padding(Spacing.lg).background(theme.bg)
        .task { model.resetHistory(); await model.loadHistory() }
        // Android reloads once the device queue has fully synced.
        .onChange(of: model.unsyncedCount) { old, new in
            if old > 0 && new == 0 { Task { await model.loadHistory() } }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 500)
        #endif
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            bodyText("Your reading, over a lifetime. Returning to a chapter in a later session counts again.")
            if let stats = model.stats {
                card {
                    Text(stats.title).font(.headline).foregroundStyle(theme.text)
                    bodyText(stats.line)
                }
            }
            if model.stats?.historicalBackfillPending == true {
                bodyText("Your earlier reading history is still being added. Lifetime totals will update when it finishes.")
            }
            card {
                bodyText("The reader logs verses you spend time viewing. A chapter is complete when all its verses have been covered in that session. For your physical Bible, tell SureWord what you read.")
                if let onTalk {
                    link("Talk to SureWord →") { dismiss(); onTalk() }
                }
            }
            if model.unsyncedCount > 0 || model.error != nil {
                card {
                    bodyText(model.error ?? "\(model.unsyncedCount) reading \(model.unsyncedCount == 1 ? "entry is" : "entries are") saved on this device, waiting to sync.")
                        .accessibilityAddTraits(.updatesFrequently)
                    link("Retry sync and refresh") {
                        model.retry()
                        Task { await model.loadHistory() }
                    }
                }
            }
            link("Refresh history") { Task { await model.loadHistory() } }
                .disabled(model.loadingHistory)
        }
    }

    private func row(_ entry: ReadingJournalEntry) -> some View {
        Button { onOpen(entry); dismiss() } label: {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(entry.reference).font(.headline).foregroundStyle(theme.text)
                bodyText(entry.sourceLabel)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(Spacing.lg)
            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).stroke(theme.borderStrong, lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open \(entry.reference)")
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if model.loadingHistory { ProgressView().tint(theme.accent).frame(maxWidth: .infinity) }
            if let error = model.historyError {
                bodyText(error)
                // Keeps the cursor: a failed "older" page retries that page.
                link("Try again") {
                    Task { await model.loadHistory(more: !model.history.isEmpty && model.nextCursor != nil) }
                }
            }
            if model.nextCursor != nil && !model.loadingHistory {
                link("Load older readings") { Task { await model.loadHistory(more: true) } }
            }
            bodyText("Need to correct or remove a reading? Ask SureWord to find the entry and make the change.")
        }
    }

    private func bodyText(_ text: String) -> some View {
        Text(text).font(.subheadline).foregroundStyle(theme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }
    private func link(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.subheadline).foregroundStyle(theme.accent).padding(.vertical, Spacing.sm)
        }
        .buttonStyle(.plain)
    }
    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm, content: content)
            .frame(maxWidth: .infinity, alignment: .leading).padding(Spacing.lg)
            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).stroke(theme.borderStrong, lineWidth: 0.5))
    }
}

/// The reader's banner. Android shows it only when a reading needs attention
/// (`chapter.tsx`), never for ordinary waiting-to-sync work.
struct ReadingSyncStatus: View {
    @Environment(\.theme) private var theme
    @Bindable var model: ReadingJournal
    var body: some View {
        if let error = model.error {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(error).font(.caption).foregroundStyle(theme.danger)
                    .accessibilityAddTraits(.isStaticText)
                Button("Retry reading sync") { model.retry() }.font(.caption)
            }
            .padding(Spacing.sm)
        }
    }
}
