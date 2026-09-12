import SwiftUI

struct ReadingHistoryView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: ReadingJournal
    var onOpen: (ReadingJournalEntry) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack {
                Text("Reading history").font(.title2.bold())
                Spacer()
                Button("Done") { dismiss() }
            }
            if let stats = model.stats {
                Text("\(stats.uniqueChapters) unique chapters · \(stats.chapterReadings) chapter readings · \(stats.partialReadings) partial readings")
                    .font(.subheadline).foregroundStyle(theme.textSecondary)
                if stats.historicalBackfillPending == true {
                    Text("Older reading history is being included. Totals are still updating.").font(.caption).foregroundStyle(theme.textMuted)
                }
            }
            ReadingSyncStatus(model: model)
            Text("SureWord records passages while you use the reader. You can also log physical Bible readings in chat.")
                .font(.caption).foregroundStyle(theme.textMuted)
            if let error = model.historyError {
                Text(error).font(.callout).foregroundStyle(theme.textSecondary)
                Button("Try again") { Task { await model.loadHistory() } }
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(model.history) { entry in
                        Button { onOpen(entry); dismiss() } label: {
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Text(entry.reference).font(.headline).foregroundStyle(theme.text)
                                Text(entry.timeLabel).font(.caption).foregroundStyle(theme.textMuted)
                                Text(sourceLabel(entry)).font(.caption).foregroundStyle(theme.textSecondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(Spacing.md)
                            .background(theme.surfaceStrong, in: .rect(cornerRadius: Radius.md))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(entry.reference), \(entry.timeLabel), \(sourceLabel(entry)). Open chapter")
                    }
                    if model.loadingHistory { ProgressView().frame(maxWidth: .infinity) }
                    else if model.nextCursor != nil { Button("Load older readings") { Task { await model.loadHistory(more: true) } } }
                    else if model.history.isEmpty && model.historyError == nil {
                        Text("Your reading history will appear here as you read in SureWord or tell the guide what you read in your physical Bible.")
                            .foregroundStyle(theme.textMuted).padding(.vertical, Spacing.xl)
                    }
                }
            }
            Button("Refresh") { model.flush(); Task { await model.loadHistory() } }
        }
        .padding(Spacing.lg).background(theme.bg)
        .task { await model.loadHistory() }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 500)
        #endif
    }
    private func sourceLabel(_ entry: ReadingJournalEntry) -> String {
        let source = entry.source == "physical" ? "Physical Bible" : entry.source == "legacy" ? "Legacy reader" : "SureWord reader"
        return source + (entry.completed ? " · whole chapter covered" : " · partial passage")
    }
}

struct ReadingSyncStatus: View {
    @Environment(\.theme) private var theme
    @Bindable var model: ReadingJournal
    var body: some View {
        if model.pendingCount > 0 || model.blockedCount > 0 || model.error != nil {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                if model.pendingCount > 0 {
                    Text("\(model.pendingCount) reading \(model.pendingCount == 1 ? "entry" : "entries") saved on this device, waiting to sync").font(.caption)
                }
                if let error = model.error { Text(error).font(.caption) }
                Button("Retry reading sync") { model.retry() }.font(.caption)
            }
            .foregroundStyle(theme.textSecondary).padding(Spacing.sm)
        }
    }
}
