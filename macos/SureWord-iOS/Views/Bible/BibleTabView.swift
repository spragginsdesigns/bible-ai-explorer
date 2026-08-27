import SwiftUI

/// One request to push the chapter reader onto the Bible tab's stack. Each
/// deep link gets a fresh identity so two jumps to the *same* verse both push.
struct BibleReaderRequest: Hashable, Identifiable {
    let id = UUID()
    let order: Int
    let chapter: Int
    let verse: Int?
}

extension Notification.Name {
    /// Posted by the Bible reader's "Ask AI" / "Expand with AI" actions after
    /// the passage has been set on `app.chat.attachment`, so the shell can
    /// switch to the Chat tab. Observed by TabShell (Lane 5); the macOS client
    /// switches sections directly in `BibleSection.askAI`.
    static let openChatWithAttachment = Notification.Name("sureword.openChatWithAttachment")
}

/// The Bible tab root: all 66 books grouped by testament (collapsible for the
/// session) and genre, the "Pick Up Your Cross" entry card, and a search pill.
///
/// Port of `mobile/app/(app)/bible/index.tsx`. The Mac's sidebar-and-panes
/// layout (`macos/SureWord/Bible/Views/`) becomes a `NavigationStack`
/// drill-down here: books → chapters → reader, with search a pushed screen
/// exactly as on Android.
struct BibleTabView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    /// Collapsed testaments, remembered for the session — Android's
    /// module-level `sessionCollapsed`. The tab stays mounted for the whole
    /// signed-in session, so `@State` has exactly that scope.
    @State private var collapsed: Set<Book.Testament> = []
    /// Non-nil pushes the reader — the chat verse-card deep-link path.
    @State private var readerRequest: BibleReaderRequest?

    private var model: BibleModel { app.bible }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                searchPill
                crossCard
                atlasCard

                ForEach(BibleBookList.rows(collapsed: collapsed)) { row in
                    switch row {
                    case .testament(let testament, let count, let expanded):
                        testamentHeader(testament, count: count, expanded: expanded)
                    case .group(let group, _):
                        groupHeader(group)
                    case .book(let book):
                        bookRow(book)
                    }
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xl)
        }
        .background { MeshBackground() }
        .navigationTitle("Bible")
        .settingsGearToolbar()
        .navigationDestination(item: $readerRequest) { request in
            ChapterReaderView(order: request.order, chapter: request.chapter, verse: request.verse)
        }
        // A verse reference tapped in chat lands here. Consume it once: the
        // tab root is long-lived, so leaving the value set would re-push the
        // same verse every time the Bible tab reappears.
        .onChange(of: app.pendingVerseReference, initial: true) { _, pending in
            guard let pending else { return }
            if let reference = Bible.resolveReference(pending) {
                model.open(reference)
                readerRequest = BibleReaderRequest(
                    order: reference.order,
                    chapter: reference.chapter,
                    verse: reference.verse
                )
            }
            app.pendingVerseReference = nil
        }
    }

    // MARK: - Header

    private var searchPill: some View {
        NavigationLink {
            BibleSearchView(model: model)
        } label: {
            HStack(spacing: Spacing.sm) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.textMuted)
                Text("Search the Bible")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.textMuted)
                Spacer()
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, 10)
            .background(theme.surface, in: .rect(cornerRadius: Radius.full))
            .overlay {
                Capsule().strokeBorder(theme.border, lineWidth: 1)
            }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .padding(.top, Spacing.sm)
        .padding(.bottom, Spacing.md)
        .accessibilityLabel("Search the Bible")
    }

    /// The way in to today's guided walk, sitting above the books exactly as it
    /// does on the Android Bible tab. Posts the shared `.openDailyCross`
    /// notification; TabShell observes it and presents Lane 5's Cross sheet.
    private var crossCard: some View {
        Button {
            NotificationCenter.default.post(name: .openDailyCross, object: nil)
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: "cross")
                    .font(.system(size: 18))
                    .foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pick Up Your Cross")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text("Today's word, chosen for your walk")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
            .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(theme.accentBorder, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .padding(.bottom, Spacing.sm)
        .accessibilityLabel("Pick Up Your Cross — today's word")
    }

    /// KJV-grounded when/who/where reference, matching the Android Bible-tab
    /// card. It pushes a native full-screen explorer inside this tab's stack.
    private var atlasCard: some View {
        NavigationLink {
            AtlasExplorerView(model: app.atlas)
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 18))
                    .foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Timeline & People")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text("When it happened, who was there, and where")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
            .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(theme.accentBorder, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .padding(.bottom, Spacing.sm)
        .accessibilityLabel("Timeline and People — when it happened, who was there, and where")
    }

    // MARK: - Books

    private func testamentHeader(
        _ testament: Book.Testament,
        count: Int,
        expanded: Bool
    ) -> some View {
        Button {
            withAnimation(.snappy) {
                if expanded { collapsed.insert(testament) } else { collapsed.remove(testament) }
            }
        } label: {
            HStack(spacing: Spacing.sm) {
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.textFaint)
                    .frame(width: 12)
                Text(testament.title.uppercased())
                    .font(.system(size: 12, weight: .bold))
                    .kerning(1.2)
                    .foregroundStyle(theme.textFaint)
                Spacer()
                Text("\(count) \(count == 1 ? "book" : "books")")
                    .font(.system(size: 12))
                    .monospacedDigit()
                    .foregroundStyle(theme.textGhost)
            }
            .padding(.top, Spacing.lg)
            .padding(.bottom, Spacing.sm)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func groupHeader(_ group: BookGroup) -> some View {
        Text(group.title.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .kerning(1)
            .foregroundStyle(theme.textMuted)
            .padding(.top, Spacing.sm)
            .padding(.bottom, Spacing.xs)
    }

    private func bookRow(_ book: Book) -> some View {
        NavigationLink {
            ChapterGridView(book: book)
        } label: {
            HStack {
                Text(book.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                Spacer()
                Text("\(book.chapters) \(book.chapters == 1 ? "chapter" : "chapters")")
                    .font(.system(size: 12))
                    .monospacedDigit()
                    .foregroundStyle(theme.textGhost)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, 14)
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(theme.border, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .padding(.bottom, Spacing.sm)
    }
}

/// Flattens the 66 books into testament headers, genre subheaders and book
/// rows — the same list shape Android builds in `index.tsx`'s `buildRows`.
/// Kept view-free so the grouping rules are unit-testable.
enum BibleBookList {
    enum Row: Equatable, Identifiable {
        case testament(Book.Testament, count: Int, expanded: Bool)
        /// `History` spans both testaments (OT history and Acts), so the
        /// testament is part of the identity — one `ForEach` renders the whole
        /// list and duplicate ids would collide.
        case group(BookGroup, in: Book.Testament)
        case book(Book)

        var id: String {
            switch self {
            case .testament(let testament, _, _): "testament-\(testament.rawValue)"
            case .group(let group, let testament): "group-\(testament.rawValue)-\(group.rawValue)"
            case .book(let book): "book-\(book.order)"
            }
        }
    }

    static func rows(collapsed: Set<Book.Testament>) -> [Row] {
        var rows: [Row] = []
        for testament in Book.Testament.allCases {
            let books = Bible.books(in: testament)
            let expanded = !collapsed.contains(testament)
            rows.append(.testament(testament, count: books.count, expanded: expanded))
            guard expanded else { continue }

            var currentGroup: BookGroup?
            for book in books {
                if let group = Bible.group(order: book.order), group != currentGroup {
                    currentGroup = group
                    rows.append(.group(group, in: testament))
                }
                rows.append(.book(book))
            }
        }
        return rows
    }
}
