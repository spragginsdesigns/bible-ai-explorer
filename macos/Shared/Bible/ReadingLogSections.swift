import SwiftUI

/// "Your walk": the reflection card at the top of the reading log, port of
/// `mobile/src/features/reading/WalkCard.tsx`. Hidden when there is nothing
/// to reflect on. State lives in `ReadingWalkModel`.
struct ReadingWalkCard: View {
    @Environment(\.theme) private var theme
    let walk: ReadingWalkModel
    var open: (ReadingLogTarget) -> Void
    /// "Talk it over →"; hidden when nil.
    var onTalk: ((String?) -> Void)?

    var body: some View {
        if walk.state != .hidden {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("YOUR WALK").font(.caption2.weight(.bold)).tracking(1.2).foregroundStyle(theme.accent)
                    .accessibilityAddTraits(.isHeader)
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.lg)
            .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Radius.lg).stroke(theme.accentBorder, lineWidth: 0.5))
            .accessibilityElement(children: .contain)
            // Only the status line is spoken on its own; a finished reflection
            // is read when the person reaches it, never announced whole.
            .onChange(of: walk.state) { _, state in
                if let status = Self.statusLine(state) { AccessibilityNotification.Announcement(status).post() }
            }
        }
    }

    private static let loadingLine = "Reflecting on your reading…"
    private static let errorLine = "Your reflection could not be written right now."

    /// The line announced for a state, nil for the ones that are not a status.
    static func statusLine(_ state: ReadingWalkModel.State) -> String? {
        switch state {
        case .loading: loadingLine
        case .error: errorLine
        default: nil
        }
    }

    @ViewBuilder
    private var content: some View {
        switch walk.state {
        case .loading, .hidden:
            HStack(spacing: Spacing.sm) {
                ProgressView().controlSize(.small).tint(theme.accent)
                muted(Self.loadingLine)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        case .consent:
            Text("SureWord can write a short reflection on what you have been reading, connected to your questions, notes and memories, with a verse to carry and where to read next.")
                .font(.body).foregroundStyle(theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            link("Write my reflection →") { Task { await walk.load(ask: true) } }
        case .error:
            muted(Self.errorLine).accessibilityAddTraits(.updatesFrequently)
            link("Try again") { Task { await walk.load() } }
        case .ready(let reflection, let generatedAt):
            ready(reflection, generatedAt: generatedAt)
        }
    }

    @ViewBuilder
    private func ready(_ reflection: ReadingReflection, generatedAt: String) -> some View {
        Text(reflection.title).font(.title3.bold()).foregroundStyle(theme.text)
            .fixedSize(horizontal: false, vertical: true)
        Text(reflection.reflection).font(.body).foregroundStyle(theme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        if let verse = reflection.verse {
            Button {
                // The card quotes the KJV, so the reader opens in it.
                open(ReadingLogTarget(book: verse.book, chapter: verse.chapter, verse: verse.verse, translation: .kjv))
            } label: {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("“\(verse.text)”").font(.custom(FontFamily.verseItalic, size: 19, relativeTo: .body))
                        .foregroundStyle(theme.text).fixedSize(horizontal: false, vertical: true)
                    Text("\(verse.bookName) \(verse.chapter):\(verse.verse)")
                        .font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                    if let note = verse.note, !note.isEmpty { muted(note) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, Spacing.md).padding(.vertical, Spacing.xs)
                .overlay(alignment: .leading) { Rectangle().fill(theme.accent).frame(width: 3) }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(verse.bookName) \(verse.chapter):\(verse.verse)")
        }
        if let next = reflection.next {
            Button {
                open(ReadingLogTarget(book: next.book, chapter: next.chapter, verse: nil, translation: nil))
            } label: {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("Read next: \(next.bookName) \(next.chapter) →")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(theme.text)
                    muted(next.reason)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Spacing.md)
                .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md).stroke(theme.borderStrong, lineWidth: 0.5))
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
        HStack(spacing: Spacing.sm) {
            Text(ReadingLogRules.reflectionAge(generatedAt, now: Date()))
                .font(.caption2).foregroundStyle(theme.textFaint)
            Spacer(minLength: Spacing.sm)
            if let onTalk {
                link("Talk it over →") { onTalk(ReadingLogRules.talkPrompt) }
            }
        }
    }

    private func muted(_ text: String) -> some View {
        Text(text).font(.subheadline).foregroundStyle(theme.textMuted).fixedSize(horizontal: false, vertical: true)
    }

    private func link(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(theme.accent).padding(.vertical, Spacing.xs)
        }
        .buttonStyle(.plain)
    }
}

/// The whole Bible at a glance, port of
/// `mobile/src/features/reading/BibleMap.tsx`: every book of a testament with
/// how many of its chapters have been read whole, and a chapter grid for the
/// selected book, opened directly under that book's row. Gold squares are
/// chapters read in one sitting; outlined ones were started.
struct ReadingBibleMap: View {
    @Environment(\.theme) private var theme
    let coverage: [ReadingBookCoverage]
    var open: (ReadingLogTarget) -> Void
    /// nil until the person picks one: the map opens on the testament with
    /// more reading.
    @State private var testament: Book.Testament?
    @State private var selected: Int?
    /// Tiles per row, from the measured width (3 on a phone, as on Android).
    @State private var columns = 3
    /// The HIG's 44 pt minimum touch target, on both platforms.
    static let square: CGFloat = 44
    /// Near-black on the gold "read" square in light and dark themes alike:
    /// the light theme's near-white background would barely show on gold.
    static let onGold = Color(white: 0.07)

    private var shown: Book.Testament { testament ?? ReadingLogRules.preferredTestament(coverage: coverage) }

    var body: some View {
        let books = ReadingLogRules.testamentProgress(coverage: coverage, testament: shown)
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Your Bible").font(.title3.bold()).foregroundStyle(theme.text)
                .accessibilityAddTraits(.isHeader)
            Picker("Testament", selection: Binding(get: { shown }, set: { testament = $0; selected = nil })) {
                ForEach(Book.Testament.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            // Row by row, so the selected book's chapters open directly under
            // its row instead of below the whole testament (39 Old Testament
            // tiles would push them off screen).
            VStack(alignment: .leading, spacing: Spacing.sm) {
                ForEach(ReadingLogRules.rows(books, columns: columns), id: \.first?.order) { row in
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        ForEach(row) { book in tile(book) }
                        ForEach(row.count..<columns, id: \.self) { _ in
                            Color.clear.frame(maxWidth: .infinity, maxHeight: 0)
                        }
                    }
                    if let book = row.first(where: { $0.order == selected }) {
                        chapters(book)
                    }
                }
            }
            .onGeometryChange(for: Int.self) { proxy in
                ReadingLogRules.mapColumns(width: proxy.size.width, minimum: 104, spacing: Spacing.sm)
            } action: { columns = $0 }
            if !books.contains(where: { $0.order == selected }) {
                #if os(macOS)
                Text("Click a book to see its chapters.").font(.caption).foregroundStyle(theme.textFaint)
                #else
                Text("Tap a book to see its chapters.").font(.caption).foregroundStyle(theme.textFaint)
                #endif
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func tile(_ book: ReadingBookProgress) -> some View {
        let isSelected = book.order == selected
        return Button { selected = isSelected ? nil : book.order } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(book.name).font(.caption.weight(.semibold)).lineLimit(1)
                    .foregroundStyle(book.touched ? theme.text : theme.textMuted)
                Text("\(book.complete.count)/\(book.chapters)").font(.caption2).foregroundStyle(theme.textFaint)
                ReadingProgressBar(fraction: book.share, height: 3, fill: theme.accent).padding(.top, 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.sm)
            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md)
                .stroke(isSelected ? theme.accent : theme.borderStrong, lineWidth: isSelected ? 1 : 0.5))
            .opacity(book.touched || isSelected ? 1 : 0.55)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(book.name), \(book.complete.count) of \(book.chapters) chapters read")
        .accessibilityValue(isSelected ? "Expanded" : "Collapsed")
    }

    private func chapters(_ book: ReadingBookProgress) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(book.chapterTitle).font(.subheadline.weight(.semibold)).foregroundStyle(theme.text)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: Self.square, maximum: Self.square), spacing: 6)], alignment: .leading, spacing: 6) {
                ForEach(1...max(1, book.chapters), id: \.self) { chapter in
                    square(book, chapter: chapter)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).stroke(theme.borderStrong, lineWidth: 0.5))
    }

    private func square(_ book: ReadingBookProgress, chapter: Int) -> some View {
        let state = book.state(of: chapter)
        return Button {
            open(ReadingLogTarget(book: book.order, chapter: chapter, verse: nil, translation: nil))
        } label: {
            Text("\(chapter)").font(.caption2.weight(.semibold))
                .foregroundStyle(state == .read ? Self.onGold : theme.textMuted)
                .frame(width: Self.square, height: Self.square)
                .background(
                    state == .read ? theme.accent : state == .started ? theme.accentSoft : theme.surfaceStrong,
                    in: .rect(cornerRadius: Radius.sm)
                )
                .overlay(RoundedRectangle(cornerRadius: Radius.sm).stroke(
                    state == .unread ? theme.border : theme.accent,
                    lineWidth: state == .started ? 1.5 : 0.5
                ))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(book.name) \(chapter), \(state == .read ? "read" : state == .started ? "started" : "not read yet")")
    }
}
