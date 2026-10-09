import SwiftUI

/// Where a tap in the reading log goes: a chapter, optionally a verse in it,
/// and the translation it was read in when the log knows it.
struct ReadingLogTarget: Equatable {
    var book: Int
    var chapter: Int
    var verse: Int?
    var translation: TranslationID?
}

/// The Reading log, mirroring Android `mobile/app/(app)/bible/history.tsx`:
/// "Your walk", the stat tiles, the Bible map and a timeline grouped by day.
/// Copy is Android's verbatim; the sheet keeps a native Done button in place
/// of Android's "‹ Bible" back link. iOS stacks everything in one column with
/// pull to refresh; the Mac sets the stats beside the map and refreshes from a
/// toolbar button, since a Mac scroll view has no pull gesture.
struct ReadingHistoryView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: ReadingJournal
    var onOpen: (ReadingLogTarget) -> Void
    /// Opens chat: `nil` for "Talk to SureWord →", a prompt to prefill for
    /// "Talk it over →". Both links are hidden where the host has no chat route.
    var onTalk: ((String?) -> Void)? = nil
    @State private var showHelp = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack {
                Text("Reading log").font(.title2.bold()).foregroundStyle(theme.text)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                #if os(macOS)
                Button { Task { await refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .disabled(model.loadingHistory)
                #endif
                Button("Done") { dismiss() }
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.lg) {
                    intro
                    let days = ReadingLogRules.groupByDay(model.history)
                    let today = ReadingLogRules.localDateKey(Date())
                    if !days.isEmpty {
                        Text("History").font(.title3.bold()).foregroundStyle(theme.text).padding(.top, Spacing.sm)
                            .accessibilityAddTraits(.isHeader)
                    }
                    ForEach(days) { day in daySection(day, today: today) }
                    if days.isEmpty && model.historyLoaded && !model.loadingHistory && model.historyError == nil {
                        emptyState
                    }
                    footer
                }
                .padding(.bottom, Spacing.xxl)
            }
            #if os(iOS)
            .refreshable { await refresh() }
            #endif
        }
        .padding(Spacing.lg).background(theme.bg)
        // Keyed on the journal, which is per account: a switch while the
        // screen is up clears entries, header, cursor and the reflection.
        .task(id: ObjectIdentifier(model)) { model.resetHistory(); await model.loadHistory() }
        .onDisappear { model.walk.cancel() }
        // The walk appears with the first logged reading (Android mounts
        // WalkCard on `hasReading`), and is written then.
        .onChange(of: model.hasReading) { _, has in
            if has { Task { await model.walk.load() } }
        }
        // Android reloads once the device queue has fully synced.
        .onChange(of: model.unsyncedCount) { old, new in
            if old > 0 && new == 0 {
                Task { await model.loadHistory() }
                reloadWalk()
            }
        }
        #if os(macOS)
        .frame(minWidth: 760, idealWidth: 900, minHeight: 640, idealHeight: 760)
        #endif
    }

    /// Pull to refresh (or the Mac's Refresh button): unblock rejected
    /// readings, reload the log and ask for a fresh reflection.
    private func refresh() async {
        model.retry()
        reloadWalk()
        await model.loadHistory()
    }

    private func reloadWalk() {
        guard model.hasReading else { return }
        Task { await model.walk.load() }
    }

    private func open(_ target: ReadingLogTarget) {
        onOpen(target)
        dismiss()
    }

    private func talk(_ prompt: String?) {
        guard let onTalk else { return }
        dismiss()
        onTalk(prompt)
    }

    // MARK: Header

    @ViewBuilder
    private var intro: some View {
        if model.hasReading {
            ReadingWalkCard(walk: model.walk, open: open, onTalk: onTalk == nil ? nil : { talk($0) })
        }
        let overview = model.hasReading ? model.overview : nil
        #if os(iOS)
        if let overview { statsRow(overview) }
        #endif
        if model.overview?.historicalBackfillPending == true {
            bodyText("Your earlier reading history is still being added. Totals will update when it finishes.")
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
        if let overview {
            #if os(macOS)
            HStack(alignment: .top, spacing: Spacing.lg) {
                VStack(spacing: Spacing.sm) {
                    ForEach(ReadingLogRules.statTiles(overview)) { statTile($0) }
                }
                .frame(width: 200)
                ReadingBibleMap(coverage: overview.books, open: open)
            }
            #else
            ReadingBibleMap(coverage: overview.books, open: open)
            #endif
        }
    }

    private func statsRow(_ overview: ReadingOverview) -> some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            ForEach(ReadingLogRules.statTiles(overview)) { statTile($0) }
        }
    }

    private func statTile(_ tile: ReadingStatTile) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(tile.value).font(.system(size: 26, weight: .bold)).foregroundStyle(theme.text)
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(tile.label).font(.caption).foregroundStyle(theme.textSecondary)
            Text(tile.sub).font(.caption2).foregroundStyle(theme.textFaint).padding(.top, 2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(Spacing.md)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).stroke(theme.borderStrong, lineWidth: 0.5))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(tile.value) \(tile.label), \(tile.sub)")
    }

    // MARK: Timeline

    private func daySection(_ day: ReadingLogDay, today: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(ReadingLogRules.dayHeading(day.date, today: today))
                .font(.caption.weight(.semibold)).foregroundStyle(theme.textMuted)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) {
                ForEach(Array(day.chapters.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { Divider().overlay(theme.border) }
                    chapterRow(row)
                }
            }
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .clipShape(.rect(cornerRadius: Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Radius.lg).stroke(theme.borderStrong, lineWidth: 0.5))
        }
    }

    private func chapterRow(_ row: ReadingDayChapter) -> some View {
        Button {
            open(ReadingLogTarget(book: row.book, chapter: row.chapter, verse: row.firstVerse,
                                  translation: TranslationID(rawValue: row.translation)))
        } label: {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(row.bookName) \(row.chapter)").font(.subheadline.weight(.semibold)).foregroundStyle(theme.text)
                    if let meta = row.meta {
                        Text(meta).font(.caption2).foregroundStyle(theme.textFaint)
                    }
                }
                Spacer(minLength: Spacing.sm)
                if row.completed {
                    Text("✓ Read").font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                } else {
                    VStack(alignment: .trailing, spacing: Spacing.xs) {
                        ReadingProgressBar(fraction: row.barFraction, height: 4, fill: theme.accentDim)
                            .frame(width: 72)
                        Text("Part").font(.caption2).foregroundStyle(theme.textFaint)
                    }
                }
            }
            .padding(.horizontal, Spacing.lg).padding(.vertical, Spacing.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(row.accessibilityLabel)
    }

    private var emptyState: some View {
        card {
            bodyText("No readings yet. Open any chapter in the Bible tab and SureWord keeps track as you read. Reading a paper Bible? Tell SureWord what you read.")
            if onTalk != nil {
                link("Talk to SureWord →") { talk(nil) }
            }
        }
    }

    // MARK: Footer

    private var footer: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            if model.loadingHistory || (!model.historyLoaded && model.historyError == nil) {
                ProgressView().tint(theme.accent).frame(maxWidth: .infinity)
            }
            if let error = model.historyError {
                bodyText(error).accessibilityAddTraits(.isStaticText)
                // Exactly the request that failed: that older page, or a full refresh.
                link("Try again") { Task { await model.retryFailedLoad() } }
            }
            if model.nextCursor != nil && !model.loadingHistory {
                link("Load older readings") { Task { await model.loadHistory(more: true) } }
            }
            link(showHelp ? "Hide how the log works" : "How the log works") { showHelp.toggle() }
                .accessibilityValue(showHelp ? "Expanded" : "Collapsed")
            if showHelp {
                bodyText("The reader counts a verse once it has been on screen for a few seconds. A chapter is marked read when you cover every verse in one sitting; coming back to it later counts again. For a paper Bible, tell SureWord what you read, and ask SureWord if an entry needs correcting or removing.")
            }
        }
    }

    // MARK: Pieces

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
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Radius.lg).stroke(theme.borderStrong, lineWidth: 0.5))
    }
}

/// A thin track with a filled share, for partial readings and book tiles.
struct ReadingProgressBar: View {
    @Environment(\.theme) private var theme
    var fraction: Double
    var height: CGFloat
    var fill: Color

    var body: some View {
        Capsule().fill(theme.border)
            .frame(height: height)
            .overlay(alignment: .leading) {
                GeometryReader { proxy in
                    Capsule().fill(fill).frame(width: proxy.size.width * min(1, max(0, fraction)))
                }
            }
            .clipShape(.capsule)
            .accessibilityHidden(true)
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
