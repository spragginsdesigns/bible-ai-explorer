import SwiftUI

/// Conversation history, as a sheet - the iOS counterpart of the Mac's
/// `HistoryPicker` and Android's `HistoryModal`. Switch, search, rename,
/// confirmed delete, clear-all (confirmed), and a new-chat row up top.
///
/// Android reveals Rename and Delete by swiping a row, with a second tap on
/// Delete ("Sure?") as the confirmation. Here the same two actions sit on the
/// row's swipe actions and its context menu; Delete asks once through a
/// confirmation dialog, and Rename edits the title in an alert. A delete the
/// server refuses comes back into the list with an alert
/// (`ChatViewModel.historyAlert`, Android 1.76.0).
struct ChatHistorySheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Bindable var chat: ChatViewModel

    @State private var query = ""
    @State private var confirmClearAll = false
    @State private var pendingDelete: Conversation?
    @State private var renaming: Conversation?
    @State private var renameValue = ""
    @State private var actionError: String?

    private var results: [Conversation] {
        HistorySearch.filter(chat.conversations, query: query)
    }

    var body: some View {
        NavigationStack {
            List {
                Button {
                    chat.newConversation()
                    dismiss()
                } label: {
                    Label("New chat", systemImage: "square.and.pencil")
                        .foregroundStyle(theme.accent)
                }

                if let actionError {
                    Text(actionError)
                        .font(.system(size: 13))
                        .foregroundStyle(theme.danger)
                        .accessibilityAddTraits(.isStaticText)
                }

                Section {
                    ForEach(results) { conversation in
                        row(conversation)
                    }
                } header: {
                    if !chat.conversations.isEmpty {
                        Text("Recent")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bgElevated)
            .searchable(text: $query, prompt: "Search conversations")
            .navigationTitle("History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !chat.conversations.isEmpty {
                        Button("Clear all", role: .destructive) {
                            confirmClearAll = true
                        }
                        .tint(theme.danger)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .alert("Clear all conversations?", isPresented: $confirmClearAll) {
                Button("Clear all", role: .destructive) {
                    Task { await chat.clearAllConversations() }
                    dismiss()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Every conversation will be deleted. This cannot be undone.")
            }
            .confirmationDialog(
                "Delete this conversation?",
                isPresented: Binding(
                    get: { pendingDelete != nil },
                    set: { if !$0 { pendingDelete = nil } }
                ),
                titleVisibility: .visible,
                presenting: pendingDelete
            ) { conversation in
                Button("Delete", role: .destructive) {
                    pendingDelete = nil
                    Task { await chat.deleteConversation(conversation.id) }
                }
                Button("Cancel", role: .cancel) { pendingDelete = nil }
            } message: { conversation in
                Text("“\(HistorySearch.displayTitle(conversation))” will be deleted. This cannot be undone.")
            }
            .alert(
                "Rename conversation",
                isPresented: Binding(
                    get: { renaming != nil },
                    set: { if !$0 { renaming = nil } }
                ),
                presenting: renaming
            ) { conversation in
                TextField("Title", text: $renameValue)
                    .onChange(of: renameValue) { _, value in
                        if value.count > ChatViewModel.maxConversationTitleLength {
                            renameValue = String(value.prefix(ChatViewModel.maxConversationTitleLength))
                        }
                    }
                    .accessibilityLabel("Rename conversation")
                Button("Save") { commitRename(conversation) }
                Button("Cancel", role: .cancel) { renaming = nil }
            }
            .historyAlert(chat)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(_ conversation: Conversation) -> some View {
        Button {
            Task { await chat.switchConversation(to: conversation.id) }
            dismiss()
        } label: {
            HStack {
                Text(HistorySearch.displayTitle(conversation))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                Spacer()
                if conversation.id == chat.activeConversationID {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.accent)
                }
            }
            .contentShape(.rect)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                pendingDelete = conversation
            } label: {
                Label("Delete", systemImage: "trash")
            }
            .accessibilityLabel("Delete \(HistorySearch.displayTitle(conversation))")
            Button {
                startRename(conversation)
            } label: {
                Label("Rename", systemImage: "pencil")
            }
            .tint(theme.accent)
            .accessibilityLabel("Rename \(HistorySearch.displayTitle(conversation))")
        }
        .contextMenu {
            Button {
                startRename(conversation)
            } label: {
                Label("Rename", systemImage: "pencil")
            }
            Button(role: .destructive) {
                pendingDelete = conversation
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private func startRename(_ conversation: Conversation) {
        actionError = nil
        renameValue = conversation.title
        renaming = conversation
    }

    private func commitRename(_ conversation: Conversation) {
        let value = renameValue
        renaming = nil
        Task {
            actionError = await chat.renameConversation(conversation.id, to: value)
        }
    }
}

/// History search and titles, view-free so the rules are testable. Matches
/// Android's `HistoryModal`: case-insensitive, on the title as shown.
enum HistorySearch {
    static func displayTitle(_ conversation: Conversation) -> String {
        conversation.title.isEmpty ? "Untitled conversation" : conversation.title
    }

    static func filter(_ conversations: [Conversation], query: String) -> [Conversation] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return conversations }
        return conversations.filter { displayTitle($0).lowercased().contains(needle) }
    }
}

extension View {
    /// Presents `ChatViewModel.historyAlert` (a delete the server refused) and
    /// clears it on dismissal. Attached to the history sheet and to the chat
    /// tab, so it shows whichever of the two is in front.
    func historyAlert(_ chat: ChatViewModel, isActive: Bool = true) -> some View {
        alert(
            chat.historyAlert?.title ?? "",
            isPresented: Binding(
                get: { isActive && chat.historyAlert != nil },
                set: { if !$0 { chat.historyAlert = nil } }
            ),
            presenting: chat.historyAlert
        ) { _ in
            Button("OK", role: .cancel) { chat.historyAlert = nil }
        } message: { alert in
            Text(alert.message)
        }
    }
}
