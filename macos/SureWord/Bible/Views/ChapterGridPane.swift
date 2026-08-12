import SwiftUI

/// Chapter-number grid for the selected book — port of
/// `mobile/app/(app)/bible/chapters.tsx`. Android fixes five columns for a
/// phone; a resizable window gets an adaptive grid of the same square cells.
struct ChapterGridPane: View {
    @Environment(\.theme) private var theme
    let model: BibleModel

    private let columns = [GridItem(.adaptive(minimum: 56, maximum: 72), spacing: Spacing.sm)]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let book = model.book {
                header(book)

                ScrollView {
                    LazyVGrid(columns: columns, spacing: Spacing.sm) {
                        ForEach(1...book.chapters, id: \.self) { chapter in
                            cell(book: book, chapter: chapter)
                        }
                    }
                    .padding(.horizontal, Spacing.xl)
                    .padding(.bottom, Spacing.xl)
                }
            } else {
                Text("That book could not be found.")
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textMuted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private func header(_ book: Book) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(book.name)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(theme.text)
            Text("\(book.chapters) \(book.chapters == 1 ? "chapter" : "chapters")")
                .font(.system(size: 12))
                .foregroundStyle(theme.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Spacing.xl)
        .padding(.top, Spacing.xl)
        .padding(.bottom, Spacing.lg)
    }

    private func cell(book: Book, chapter: Int) -> some View {
        Button {
            model.open(order: book.order, chapter: chapter)
        } label: {
            Text("\(chapter)")
                .font(.system(size: 14, weight: .semibold))
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
