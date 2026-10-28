import SwiftUI

/// Chapter-number grid for one book - port of
/// `mobile/app/(app)/bible/chapters.tsx`. Five columns, same as Android's
/// phone grid (the Mac's resizable window uses an adaptive grid instead).
///
/// From the book list each number pushes a reader. Inside the reader (the
/// title's "Choose chapter") it is handed `onSelect` instead, so a pick pages
/// the open reader rather than stacking a second one, and `current` marks the
/// chapter on screen.
struct ChapterGridView: View {
    @Environment(\.theme) private var theme
    let book: Book
    var current: Int? = nil
    var onSelect: ((Int) -> Void)? = nil

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: Spacing.sm),
        count: 5
    )

    var body: some View {
        ScrollView {
            Text("\(book.chapters) \(book.chapters == 1 ? "chapter" : "chapters")")
                .appFont(.system(size: 12))
                .foregroundStyle(theme.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Spacing.lg)
                .padding(.top, Spacing.sm)
                .padding(.bottom, Spacing.md)

            LazyVGrid(columns: columns, spacing: Spacing.sm) {
                ForEach(1...book.chapters, id: \.self) { chapter in
                    Group {
                        if let onSelect {
                            Button {
                                onSelect(chapter)
                            } label: {
                                cell(chapter)
                            }
                        } else {
                            NavigationLink {
                                ChapterReaderView(order: book.order, chapter: chapter)
                            } label: {
                                cell(chapter)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(book.name) chapter \(chapter)")
                    .accessibilityAddTraits(chapter == current ? .isSelected : [])
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xl)
        }
        .background { MeshBackground() }
        .navigationTitle(book.name)
    }

    private func cell(_ chapter: Int) -> some View {
        let isCurrent = chapter == current
        return Text("\(chapter)")
            .appFont(.system(size: 15, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(isCurrent ? theme.accent : theme.textSecondary)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 56)
            .background(isCurrent ? theme.accentSoft : theme.surface, in: .rect(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(isCurrent ? theme.accentBorder : theme.border, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.md))
    }
}
