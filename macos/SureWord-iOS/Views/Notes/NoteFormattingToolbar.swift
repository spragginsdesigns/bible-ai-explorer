import SwiftUI

/// The formatting bar, hosted in the keyboard's toolbar area — the iOS home of
/// the vocabulary the web `EditorToolbar.tsx` and TenTap's toolbar on Android
/// share, which is what bounds it: every control here produces markup the
/// other two clients can parse, and there is no control for anything they
/// cannot.
///
/// Undo/redo buttons from the Mac bar are deliberately absent: the system
/// undo gesture covers typing, and structural edits do not register with the
/// UITextView undo stack (see `NoteRichTextController.render`).
///
/// Deferred (Lane 4, confirmed by Lane 6): hardware-keyboard Tab/⇧Tab does
/// not indent/outdent — list nesting is toolbar-only for now.
struct NoteFormattingToolbar: View {
    @Environment(\.theme) private var theme
    @Bindable var controller: NoteRichTextController
    var onEditLink: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                markButton("bold", .bold, help: "Bold")
                markButton("italic", .italic, help: "Italic")
                markButton("underline", .underline, help: "Underline")
                markButton("strikethrough", .strike, help: "Strikethrough")
                markButton("highlighter", .highlight, help: "Highlight")
                markButton("chevron.left.forwardslash.chevron.right", .code, help: "Inline code")
                separator
                headingButton(1)
                headingButton(2)
                headingButton(3)
                separator
                listButton("list.bullet", .bulletList, help: "Bullet list")
                listButton("list.number", .orderedList, help: "Numbered list")
                listButton("checklist", .taskList, help: "Task list")
                button("decrease.indent", help: "Outdent") {
                    controller.outdentList()
                }
                .disabled(!controller.canOutdentList)
                .opacity(controller.canOutdentList ? 1 : 0.35)
                button("increase.indent", help: "Indent") {
                    controller.indentList()
                }
                .disabled(!controller.canIndentList)
                .opacity(controller.canIndentList ? 1 : 0.35)
                separator
                button("text.quote", help: "Blockquote", isActive: controller.activeBlock.isInBlockquote) {
                    controller.toggleBlockquote()
                }
                button("curlybraces", help: "Code block", isActive: controller.activeBlock.isInPreformatted) {
                    controller.toggleCodeBlock()
                }
                button("link", help: "Link", isActive: controller.activeMarks.contains(.link)) {
                    onEditLink()
                }
                button("minus", help: "Horizontal rule") { controller.insertHorizontalRule() }
                separator
                alignButton("text.alignleft", .left)
                alignButton("text.aligncenter", .center)
                alignButton("text.alignright", .right)
            }
            .padding(.horizontal, Spacing.sm)
        }
    }

    // MARK: Pieces

    private var separator: some View {
        Rectangle()
            .fill(theme.border)
            .frame(width: 1, height: 16)
            .padding(.horizontal, 4)
    }

    private func button(
        _ symbol: String,
        help: String,
        isActive: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14))
                .foregroundStyle(isActive ? theme.accent : theme.textMuted)
                // One-finger targets while typing; smaller than this and the
                // bar is unusable on a phone.
                .frame(width: 32, height: 32)
                .background(isActive ? theme.accentSoft : .clear, in: .rect(cornerRadius: Radius.sm))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(help)
    }

    private func markButton(_ symbol: String, _ kind: NoteMark.Kind, help: String) -> some View {
        button(symbol, help: help, isActive: controller.activeMarks.contains(kind)) {
            controller.toggle(kind)
        }
    }

    private func headingButton(_ level: Int) -> some View {
        button(
            "\(level).square",
            help: "Heading \(level)",
            isActive: controller.activeBlock.headingLevel == level
        ) {
            controller.setBlockKind(.heading(level: level))
        }
    }

    private func listButton(_ symbol: String, _ kind: NoteContainer.Kind, help: String) -> some View {
        button(symbol, help: help, isActive: controller.activeBlock.listContainer?.kind == kind) {
            controller.toggleList(kind)
        }
    }

    private func alignButton(_ symbol: String, _ alignment: NoteAlignment) -> some View {
        button(
            symbol,
            help: "Align \(alignment.rawValue)",
            isActive: controller.activeBlock.alignment == alignment
        ) {
            controller.setAlignment(alignment)
        }
    }
}
