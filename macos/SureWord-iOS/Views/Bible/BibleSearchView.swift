import SwiftUI

/// Offline verse search over the bundled KJV plus a "John 3:16"-style
/// reference quick-jump — port of `mobile/app/(app)/bible/search.tsx` and the
/// search half of the Mac's `BibleSidebar`. The 300 ms debounce lives in the
/// task itself: a superseded run is cancelled during the sleep, so the first
/// search — which parses every book's JSON — only happens once typing stops.
struct BibleSearchView: View {
    @Environment(\.theme) private var theme
    @Bindable var model: BibleModel

    /// Non-nil pushes the reader with the chosen hit or reference.
    @State private var readerRequest: BibleReaderRequest?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.sm) {
                if let jump = model.referenceJump {
                    jumpRow(jump)
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
                    hitRow(hit)
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.lg)
        }
        .background { MeshBackground() }
        .navigationTitle("Search")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(
            text: $model.query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Search verses or \"John 3:16\""
        )
        .task(id: model.query) {
            try? await Task.sleep(for: BibleModel.searchDebounce)
            guard !Task.isCancelled else { return }
            await model.runSearch()
        }
        .navigationDestination(item: $readerRequest) { request in
            ChapterReaderView(order: request.order, chapter: request.chapter, verse: request.verse)
        }
    }

    private func jumpRow(_ reference: Reference) -> some View {
        Button {
            open(reference)
        } label: {
            HStack(spacing: Spacing.sm) {
                Text("Go to \(label(for: reference))")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.accent)
                Spacer()
                Image(systemName: "arrow.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
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
    }

    private func hitRow(_ hit: KJVSearchHit) -> some View {
        Button {
            open(Reference(order: hit.order, chapter: hit.chapter, verse: hit.verse))
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

    private func open(_ reference: Reference) {
        model.open(reference)
        readerRequest = BibleReaderRequest(
            order: reference.order,
            chapter: reference.chapter,
            verse: reference.verse
        )
    }

    private func label(for reference: Reference) -> String {
        let name = Bible.book(order: reference.order)?.name ?? ""
        guard let verse = reference.verse else { return "\(name) \(reference.chapter)" }
        return "\(name) \(reference.chapter):\(verse)"
    }
}
