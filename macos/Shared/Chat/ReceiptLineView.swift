import SwiftUI

// MARK: - Fragments (pure)

/// One run on the receipts line. A receipt is always one fragment; a receipt
/// that can be undone is followed by a second fragment that performs the undo,
/// and reads "Forgotten" once it has.
///
/// Pure and `Equatable` so the line's wording and ordering are testable without
/// a view: `ReceiptLineTests`.
struct ReceiptFragment: Identifiable, Equatable, Sendable {
    enum Role: Equatable, Sendable {
        /// Tapping dispatches on `ChatReceipt.target`.
        case open(ChatReceipt)
        /// Tapping deletes the memory. `receiptID` keys the line's state, so a
        /// second receipt over the same memory undoes independently.
        case undo(receiptID: String, memoryID: String)
        /// The receipt itself, once its undo succeeded. It *replaces* the
        /// receipt's own fragment and the undo beside it, so the line never
        /// reads "Remembered \u{00B7} Forgotten". Never tappable, never re-fires.
        case forgotten
    }

    var id: String
    var label: String
    var role: Role
    /// The separator renders after every fragment but the last.
    var isLast: Bool
}

extension ReceiptFragment {
    static let undoLabel = "Undo"
    static let forgottenLabel = "Forgotten"
    /// The contract joins fragments with " \u{00B7} "; the spaces either side come
    /// from the fragments' own button padding, so only the glyph is drawn.
    static let separator = "\u{00B7}"

    /// The whole line, in receipt order. `forgotten` holds the receipt ids whose
    /// undo has already succeeded on this client: such a receipt collapses to a
    /// single "Forgotten" fragment, exactly as the web client renders it.
    static func build(receipts: [ChatReceipt], forgotten: Set<String> = []) -> [ReceiptFragment] {
        var fragments: [ReceiptFragment] = []
        for (index, receipt) in receipts.enumerated() {
            // Two receipts of a turn can only share an id if the server repeated
            // a tool call id; the index keeps every fragment id unique anyway.
            let base = "\(index)-\(receipt.id)"
            guard let undo = receipt.undo, case .forgetMemory(let memoryID) = undo else {
                fragments.append(
                    ReceiptFragment(id: base, label: receipt.label, role: .open(receipt), isLast: false)
                )
                continue
            }
            // Undoable, so the id in `forgotten` can only have been put there by
            // this receipt's own undo.
            if forgotten.contains(receipt.id) {
                fragments.append(
                    ReceiptFragment(id: base, label: forgottenLabel, role: .forgotten, isLast: false)
                )
                continue
            }
            fragments.append(
                ReceiptFragment(id: base, label: receipt.label, role: .open(receipt), isLast: false)
            )
            fragments.append(
                ReceiptFragment(
                    id: "\(base):undo",
                    label: undoLabel,
                    role: .undo(receiptID: receipt.id, memoryID: memoryID),
                    isLast: false
                )
            )
        }
        if !fragments.isEmpty { fragments[fragments.count - 1].isLast = true }
        return fragments
    }
}

/// Destinations an Apple shell has to name rather than navigate to, and the one
/// piece of target translation both shells need.
enum ReceiptLine {
    /// "John 3:16" for a chapter target, or nil when the book number is not one
    /// of the 66 - `Bible.book(order:)` (`Shared/Bible/BibleBooks.swift:83`).
    /// Both shells open the reader by reference string, not by book number.
    static func chapterReference(book: Int, chapter: Int, verse: Int?) -> String? {
        guard let name = Bible.book(order: book)?.name else { return nil }
        guard let verse else { return "\(name) \(chapter)" }
        return "\(name) \(chapter):\(verse)"
    }

    /// Settings is a sheet on the Mac and a pushed route on iOS, neither of
    /// which takes a section, so a settings receipt says where to look.
    static func settingsMessage(for section: ChatReceiptSettingsSection?) -> String {
        switch section {
        case .memory: "Open Settings \u{2192} Memory"
        case .church: "Open Settings \u{2192} My church"
        case .preferences: "Open Settings \u{2192} Web Search"
        case nil: "Open Settings to see that change."
        }
    }
}

// MARK: - View

/// The receipts line: everything the assistant saved this turn, as one wrapping
/// line of tappable fragments joined by " \u{00B7} ", under the answer.
///
/// The contract is `docs/FEATURES.md` -> "Receipts: one line for everything the
/// assistant saves". Parsing belongs to `ChatViewMessage.buildReceipts`
/// (`Shared/Chat/ChatViewMessage.swift:380`); this view only renders and
/// dispatches, so macOS and iOS share it and differ only in where a tap lands.
struct ReceiptLineView: View {
    @Environment(\.theme) private var theme

    let receipts: [ChatReceipt]
    /// The undo fragment's only use: `DELETE /api/memories/{id}` through
    /// `APIClient.deleteMemory` (`Shared/Memories/MemoriesAPI.swift:113`).
    let api: APIClient
    /// Tapping a fragment. Every destination belongs to the platform shell.
    var onOpen: (ChatReceipt) -> Void
    /// A failed undo has nowhere of its own to complain, so the shell toasts it.
    var onError: (String) -> Void

    /// Receipt ids undone on this client. The contract scopes "Forgotten" to the
    /// session, and a bubble lives exactly that long.
    @State private var forgotten: Set<String> = []
    /// Ids with a DELETE in flight, so a double tap never fires it twice.
    @State private var forgetting: Set<String> = []

    var body: some View {
        if !receipts.isEmpty {
            ReceiptFlow(lineSpacing: Spacing.xs) {
                ForEach(ReceiptFragment.build(receipts: receipts, forgotten: forgotten)) { fragment in
                    fragmentView(fragment)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func fragmentView(_ fragment: ReceiptFragment) -> some View {
        HStack(spacing: 0) {
            switch fragment.role {
            case .open(let receipt):
                Button { onOpen(receipt) } label: {
                    label(fragment.label, color: theme.accent)
                }
                .buttonStyle(SubtleButtonStyle())
                .accessibilityLabel(fragment.label)

            case .undo(let receiptID, let memoryID):
                Button { forget(receiptID: receiptID, memoryID: memoryID) } label: {
                    label(fragment.label, color: theme.accent)
                }
                .buttonStyle(SubtleButtonStyle())
                .disabled(forgetting.contains(receiptID))
                .accessibilityLabel(fragment.label)

            case .forgotten:
                label(fragment.label, color: theme.textFaint)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
            }

            if !fragment.isLast {
                Text(ReceiptFragment.separator)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textFaint)
                    .accessibilityHidden(true)
            }
        }
    }

    private func label(_ text: String, color: Color) -> some View {
        Text(text).font(.system(size: 12)).foregroundStyle(color)
    }

    private func forget(receiptID: String, memoryID: String) {
        guard !forgetting.contains(receiptID), !forgotten.contains(receiptID) else { return }
        forgetting.insert(receiptID)
        Task {
            do {
                try await api.deleteMemory(id: memoryID)
                forgotten.insert(receiptID)
            } catch let error as APIError where error.status == 404 {
                // Already deleted - on another client, or by a `deleteMemories`
                // call in a later turn. The undo asked for it to be gone and it
                // is, so this is a success, not something to complain about.
                // `APIError.status` (`Shared/Networking/APIError.swift:10`).
                forgotten.insert(receiptID)
            } catch {
                onError((error as? APIError)?.message ?? "That memory could not be forgotten.")
            }
            forgetting.remove(receiptID)
        }
    }
}

// MARK: - Layout

/// Wrapping row of receipt fragments. A `Layout` rather than an `HStack` because
/// a turn can save several things and the line has to fold on a phone.
///
/// Mirrors `OriginalWordFlow` in `Shared/Bible/OriginalLanguageView.swift:236`,
/// minus its right-to-left mode; the fragments carry their own spacing as
/// padding, so items are placed flush.
private struct ReceiptFlow: Layout {
    var lineSpacing: CGFloat = Spacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = layout(subviews: subviews, width: width)
        let height = rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(rows.count - 1, 0))
        let widest = rows.map(\.width).max() ?? 0
        return CGSize(width: min(width, max(widest, 0)), height: height)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var y = bounds.minY
        for row in layout(subviews: subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: x, y: y),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(size)
                )
                x += size.width
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func layout(subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let advance = row.width + size.width
            if !row.indices.isEmpty, advance > width {
                rows.append(row)
                row = Row()
                row.indices = [index]
                row.width = size.width
                row.height = size.height
            } else {
                row.indices.append(index)
                row.width = advance
                row.height = max(row.height, size.height)
            }
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}
