import SwiftUI

/// Translation-aware verse search plus a "John 3:16"-style reference
/// quick-jump - port of `mobile/app/(app)/bible/search.tsx`. BSB and KJV search
/// the bundle offline; NKJV goes to bolls.life; a miss checks the other
/// wording, and the status line says which translation answered. The debounce
/// lives in the task, so a superseded search is cancelled during the sleep.
struct BibleSearchView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    @State private var search = BibleSearchModel()
    /// Non-nil pushes the reader with the chosen hit or reference.
    @State private var readerRequest: BibleReaderRequest?

    /// Android lists the search chips in this order.
    private static let chips: [TranslationID] = [.kjv, .nkjv, .bsb]

    private var account: TranslationID { app.settings.translation }
    private var translation: TranslationID { search.translation(account: account) }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.sm) {
                translationChips

                if let jump = search.referenceJump {
                    jumpRow(jump)
                }

                if let error = search.error {
                    Text(error)
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                        .padding(.vertical, Spacing.xs)
                    Button("Retry search") { search.retry() }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(theme.accent)
                        .buttonStyle(.plain)
                } else if let status = search.status(account: account) {
                    Text(status)
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                        .padding(.vertical, Spacing.xs)
                        .accessibilityAddTraits(.updatesFrequently)
                } else if search.searched.isEmpty, !search.loading {
                    Text(search.hint(account: account))
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                        .padding(.vertical, Spacing.md)
                }

                ForEach(search.hits) { hit in
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
            text: $search.query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Search verses or try \"John 3:16\""
        )
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        #if DEBUG
        .onAppear {
            if UIEvidenceHarness.isEnabled, let query = UserDefaults.standard.string(forKey: "evidence.query") {
                search.query = query
            }
        }
        #endif
        .task(id: search.taskKey(account: account)) {
            await search.run(account: account)
        }
        .navigationDestination(item: $readerRequest) { request in
            ChapterReaderView(
                order: request.order,
                chapter: request.chapter,
                verse: request.verse,
                translation: request.translation
            )
        }
    }

    private var translationChips: some View {
        HStack(spacing: Spacing.sm) {
            ForEach(Self.chips, id: \.self) { id in
                let active = translation == id
                Button {
                    search.selectedTranslation = id
                } label: {
                    Text(id.label)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(active ? theme.accent : theme.textMuted)
                        .padding(.horizontal, Spacing.md)
                        .frame(minHeight: 32)
                        .background(active ? theme.accentSoft : theme.surface, in: .capsule)
                        .overlay {
                            Capsule().strokeBorder(active ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
                        }
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Search \(id.label)")
                .accessibilityAddTraits(active ? .isSelected : [])
            }
            Spacer()
        }
        .padding(.top, Spacing.sm)
    }

    private func jumpRow(_ reference: Reference) -> some View {
        Button {
            open(reference, translation: translation)
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

    private func hitRow(_ hit: BibleSearchHit) -> some View {
        Button {
            open(Reference(order: hit.order, chapter: hit.chapter, verse: hit.verse), translation: hit.translation)
        } label: {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("\(Bible.book(order: hit.order)?.name ?? "Book \(hit.order)") \(hit.chapter):\(hit.verse) \(hit.translation.label)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(theme.accent)
                Text(hit.text)
                    .font(.custom(FontFamily.verse, size: 15))
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

    /// The hit opens in the translation whose wording matched - a one-hop
    /// override that never changes the account translation.
    private func open(_ reference: Reference, translation: TranslationID) {
        app.bible.open(reference)
        readerRequest = BibleReaderRequest(
            order: reference.order,
            chapter: reference.chapter,
            verse: reference.verse,
            translation: translation == account ? nil : translation
        )
    }

    private func label(for reference: Reference) -> String {
        let name = Bible.book(order: reference.order)?.name ?? ""
        guard let verse = reference.verse else { return "\(name) \(reference.chapter)" }
        return "\(name) \(reference.chapter):\(verse)"
    }
}
