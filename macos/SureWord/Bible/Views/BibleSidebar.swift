import SwiftUI

/// Book picker and offline search, ported from `mobile/app/(app)/bible/index.tsx`
/// and `search.tsx`. Typing swaps the book list for results plus the
/// reference quick-jump; clearing the field brings the books back.
struct BibleSidebar: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Bindable var model: BibleModel
    let onShowAtlas: () -> Void
    let onShowPlan: () -> Void
    let onShowBible: () -> Void

    /// Collapsed testaments, remembered for as long as the section is alive —
    /// the same scope as Android's module-level `sessionCollapsed`.
    @State private var collapsed: Set<Book.Testament> = []

    var body: some View {
        VStack(spacing: 0) {
            searchField

            if model.isSearching {
                searchResults
            } else {
                planCard
                atlasCard
                crossCard
                bookList
            }
        }
        // The card shows where the plan stands; the pane owns every action, so
        // this only ever needs the one load per session.
        .task { model.plan.loadIfNeeded() }
        // Debounced in the task itself: a superseded run is cancelled during
        // the sleep, so the first call — which parses every book's JSON — only
        // happens once the typing stops.
        .task(id: model.query) {
            try? await Task.sleep(for: BibleModel.searchDebounce)
            guard !Task.isCancelled else { return }
            await model.runSearch()
        }
    }

    // MARK: - Reading plan

    /// Top of the Bible screen on every client: today's reading, or an
    /// invitation to start. Mirrors the Android Bible tab's plan card
    /// (`mobile/app/(app)/bible/index.tsx`) and web's `BibleBookPicker`.
    private var planCard: some View {
        let plan = model.plan.plan
        return Button(action: onShowPlan) {
            HStack(spacing: Spacing.md) {
                Image(systemName: "calendar.day.timeline.left")
                    .font(.system(size: 16))
                    .foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(plan?.title ?? "Reading plan")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(theme.accent)
                        .lineLimit(1)
                    Text(PlanView.planCardSubtitle(plan))
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.md)
            .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(theme.accentBorder, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .help(plan == nil ? "Start a reading plan" : "Reading plan - today's reading")
        .accessibilityLabel(plan == nil ? "Start a reading plan" : "Reading plan, today's reading")
        .padding(.horizontal, Spacing.md)
        .padding(.bottom, Spacing.sm)
    }

    // MARK: - Daily Cross

    private var atlasCard: some View {
        Button(action: onShowAtlas) {
            HStack(spacing: Spacing.md) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 17))
                    .foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Timeline, People & Places")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text("Explore Scripture's people and places")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.md)
            .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(theme.accentBorder, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .help("Explore Bible timeline, people and places")
        .accessibilityLabel("Open Bible timeline, people and places")
        .padding(.horizontal, Spacing.md)
        .padding(.bottom, Spacing.sm)
    }

    /// The ✝ way in to today's guided walk, sitting above the books exactly as
    /// it does on the Android Bible tab and the web `/bible` page. It is also a
    /// sidebar section of its own here — a Mac has room for both, and this is
    /// the entry point someone reading their Bible will actually see.
    private var crossCard: some View {
        Button {
            app.section = .cross
        } label: {
            HStack(spacing: Spacing.md) {
                Text("✝")
                    .font(.system(size: 18))
                    .foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pick Up Your Cross")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text("Today's word, chosen for your walk")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Text("›")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.md)
            .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(theme.accentBorder, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .help("Today's word, chosen for your walk")
        .padding(.horizontal, Spacing.md)
        .padding(.bottom, Spacing.sm)
    }

    // MARK: - Search

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12))
                .foregroundStyle(theme.textGhost)

            TextField("Search verses or \"John 3:16\"", text: $model.query)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .foregroundStyle(theme.text)

            if !model.query.isEmpty {
                Button {
                    model.clearSearch()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textGhost)
                }
                .buttonStyle(.plain)
                .help("Clear search")
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1)
        }
        .padding(Spacing.md)
    }

    private var searchResults: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.sm) {
                if let jump = model.referenceJump {
                    Button {
                        onShowBible()
                        model.open(jump)
                    } label: {
                        Text("Go to \(label(for: jump)) →")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(theme.accent)
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
                }

                if let summary = model.searchSummary {
                    Text(summary)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textFaint)
                        .padding(.vertical, Spacing.xs)
                } else if model.searchedQuery.isEmpty {
                    // Shown whenever no search has run yet, reference or not —
                    // `search.tsx` renders the hint on the same condition.
                    Text("Search the King James text by word or phrase.")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                        .padding(.vertical, Spacing.md)
                }

                ForEach(model.searchHits) { hit in
                    Button {
                        onShowBible()
                        model.open(order: hit.order, chapter: hit.chapter, verse: hit.verse)
                    } label: {
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text("\(Bible.book(order: hit.order)?.name ?? "Book \(hit.order)") \(hit.chapter):\(hit.verse)")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(theme.accent)
                            Text(hit.text)
                                .font(.custom(FontFamily.verse, size: 14))
                                .foregroundStyle(theme.textSecondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Spacing.md)
                        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                        .overlay {
                            RoundedRectangle(cornerRadius: Radius.md)
                                .strokeBorder(theme.border, lineWidth: 1)
                        }
                        .contentShape(.rect(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Spacing.md)
            .padding(.bottom, Spacing.lg)
        }
    }

    private func label(for reference: Reference) -> String {
        let name = Bible.book(order: reference.order)?.name ?? ""
        guard let verse = reference.verse else { return "\(name) \(reference.chapter)" }
        return "\(name) \(reference.chapter):\(verse)"
    }

    // MARK: - Books

    private var bookList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Book.Testament.allCases) { testament in
                    testamentHeader(testament)

                    if !collapsed.contains(testament) {
                        ForEach(rows(in: testament), id: \.id) { row in
                            switch row {
                            case .group(let group):
                                Text(group.title.uppercased())
                                    .font(.system(size: 10, weight: .semibold))
                                    .kerning(1)
                                    .foregroundStyle(theme.textMuted)
                                    .padding(.top, Spacing.sm)
                                    .padding(.bottom, Spacing.xs)
                            case .book(let book):
                                bookRow(book)
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.md)
            .padding(.bottom, Spacing.lg)
        }
    }

    private func testamentHeader(_ testament: Book.Testament) -> some View {
        let books = Bible.books(in: testament)
        let expanded = !collapsed.contains(testament)
        return Button {
            if expanded { collapsed.insert(testament) } else { collapsed.remove(testament) }
        } label: {
            HStack(spacing: Spacing.sm) {
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(theme.textFaint)
                    .frame(width: 10)
                Text(testament.title.uppercased())
                    .font(.system(size: 10, weight: .bold))
                    .kerning(1.2)
                    .foregroundStyle(theme.textFaint)
                Spacer()
                Text("\(books.count) books")
                    .font(.system(size: 10))
                    .monospacedDigit()
                    .foregroundStyle(theme.textGhost)
            }
            .padding(.top, Spacing.lg)
            .padding(.bottom, Spacing.sm)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func bookRow(_ book: Book) -> some View {
        let isSelected = model.selectedBook == book.order
        return Button {
            onShowBible()
            model.selectBook(book.order)
        } label: {
            HStack {
                Text(book.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(isSelected ? theme.accent : theme.textSecondary)
                Spacer()
                Text("\(book.chapters)")
                    .font(.system(size: 11))
                    .monospacedDigit()
                    .foregroundStyle(theme.textGhost)
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .background(
                isSelected ? theme.accentSoft : theme.surface,
                in: .rect(cornerRadius: Radius.md)
            )
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(isSelected ? theme.accentBorder : theme.border, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
        .padding(.bottom, Spacing.xs)
    }

    /// Genre subheaders interleaved with the books of one testament, exactly as
    /// Android flattens them.
    private enum Row {
        case group(BookGroup)
        case book(Book)

        var id: String {
            switch self {
            case .group(let group): "group-\(group.rawValue)"
            case .book(let book): "book-\(book.order)"
            }
        }
    }

    private func rows(in testament: Book.Testament) -> [Row] {
        var rows: [Row] = []
        var currentGroup: BookGroup?
        for book in Bible.books(in: testament) {
            if let group = Bible.group(order: book.order), group != currentGroup {
                currentGroup = group
                rows.append(.group(group))
            }
            rows.append(.book(book))
        }
        return rows
    }
}
