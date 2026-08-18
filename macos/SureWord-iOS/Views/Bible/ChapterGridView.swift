import SwiftUI

/// Chapter-number grid for one book — port of
/// `mobile/app/(app)/bible/chapters.tsx`. Five columns, same as Android's
/// phone grid (the Mac's resizable window uses an adaptive grid instead).
struct ChapterGridView: View {
    @Environment(\.theme) private var theme
    let book: Book

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: Spacing.sm),
        count: 5
    )

    var body: some View {
        ScrollView {
            Text("\(book.chapters) \(book.chapters == 1 ? "chapter" : "chapters")")
                .font(.system(size: 12))
                .foregroundStyle(theme.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Spacing.lg)
                .padding(.top, Spacing.sm)
                .padding(.bottom, Spacing.md)

            LazyVGrid(columns: columns, spacing: Spacing.sm) {
                ForEach(1...book.chapters, id: \.self) { chapter in
                    NavigationLink {
                        ChapterReaderView(order: book.order, chapter: chapter)
                    } label: {
                        Text("\(chapter)")
                            .font(.system(size: 15, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(theme.textSecondary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                            .overlay {
                                RoundedRectangle(cornerRadius: Radius.md)
                                    .strokeBorder(theme.border, lineWidth: 1)
                            }
                            .contentShape(.rect(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(book.name) chapter \(chapter)")
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xl)
        }
        .background { MeshBackground() }
        .navigationTitle(book.name)
    }
}
