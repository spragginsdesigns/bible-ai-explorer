import SwiftUI

/// The formatting bar — the same vocabulary as the web `EditorToolbar.tsx` and
/// TenTap's toolbar on Android, which is what bounds it: every control here
/// produces markup the other two clients can parse, and there is no control for
/// anything they cannot.
struct NoteFormattingToolbar: View {
    @Environment(\.theme) private var theme
    @Bindable var controller: NoteRichTextController
    var onEditLink: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                group {
                    button("arrow.uturn.backward", help: "Undo") { undo() }
                    button("arrow.uturn.forward", help: "Redo") { redo() }
                }
                separator
                group {
                    markButton("bold", .bold, help: "Bold (⌘B)")
                    markButton("italic", .italic, help: "Italic (⌘I)")
                    markButton("underline", .underline, help: "Underline (⌘U)")
                    markButton("strikethrough", .strike, help: "Strikethrough")
                    markButton("highlighter", .highlight, help: "Highlight")
                    markButton("chevron.left.forwardslash.chevron.right", .code, help: "Inline code")
                }
                separator
                group {
                    headingButton(1)
                    headingButton(2)
                    headingButton(3)
                }
                separator
                group {
                    listButton("list.bullet", .bulletList, help: "Bullet list")
                    listButton("list.number", .orderedList, help: "Numbered list")
                    listButton("checklist", .taskList, help: "Task list")
                    // Nesting is only meaningful inside a list, and indent needs
                    // a previous sibling to nest under — so both dim out rather
                    // than silently doing nothing.
                    button("decrease.indent", help: "Outdent (⇧⇥)") {
                        controller.outdentList()
                    }
                    .disabled(!controller.canOutdentList)
                    .opacity(controller.canOutdentList ? 1 : 0.35)
                    button("increase.indent", help: "Indent (⇥)") {
                        controller.indentList()
                    }
                    .disabled(!controller.canIndentList)
                    .opacity(controller.canIndentList ? 1 : 0.35)
                }
                separator
                group {
                    button(
                        "text.quote",
                        help: "Blockquote",
                        isActive: controller.activeBlock.isInBlockquote
                    ) { controller.toggleBlockquote() }
                    button(
                        "curlybraces",
                        help: "Code block",
                        isActive: controller.activeBlock.isInPreformatted
                    ) { controller.toggleCodeBlock() }
                    button("link", help: "Link", isActive: controller.activeMarks.contains(.link)) {
                        onEditLink()
                    }
                    button("minus", help: "Horizontal rule") { controller.insertHorizontalRule() }
                }
                separator
                group {
                    alignButton("text.alignleft", .left)
                    alignButton("text.aligncenter", .center)
                    alignButton("text.alignright", .right)
                }
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, 5)
        }
        // Menu-less keyboard shortcuts for the three marks every editor has.
        .background {
            Group {
                shortcut("b") { controller.toggle(.bold) }
                shortcut("i") { controller.toggle(.italic) }
                shortcut("u") { controller.toggle(.underline) }
            }
            .hidden()
        }
    }

    // MARK: Pieces

    @ViewBuilder
    private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 2) { content() }
    }

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
                .font(.system(size: 12))
                .foregroundStyle(isActive ? theme.accent : theme.textMuted)
                .frame(width: 26, height: 24)
                .background(isActive ? theme.accentSoft : .clear, in: .rect(cornerRadius: Radius.sm))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help(help)
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

    private func shortcut(_ key: KeyEquivalent, action: @escaping () -> Void) -> some View {
        Button("", action: action)
            .keyboardShortcut(key, modifiers: .command)
            .frame(width: 0, height: 0)
            .opacity(0)
    }

    private func undo() {
        controller.textView?.undoManager?.undo()
        controller.textDidChange()
    }

    private func redo() {
        controller.textView?.undoManager?.redo()
        controller.textDidChange()
    }
}
