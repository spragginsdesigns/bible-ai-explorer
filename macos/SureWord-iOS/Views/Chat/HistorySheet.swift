import SwiftUI

/// Conversation history, as a sheet - the iOS counterpart of the Mac's
/// `HistoryPicker` and Android's `HistoryModal`. Switch, search, rename,
/// confirmed delete, clear-all (confirmed), and a new-chat row up top.
///
/// Rename and Delete sit on the row's swipe actions (Android swipes the row
/// too) and its context menu; the dialogs behind them are the shared
/// `ConversationActions`. A delete the server refuses comes back into the list
/// with an alert (`ChatViewModel.historyAlert`, Android 1.76.0).
struct ChatHistorySheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Bindable var chat: ChatViewModel

    @State private var query = ""
    @State private var confirmClearAll = false
    @State private var actions = ConversationActions()

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

                if let actionError = actions.error {
                    Text(actionError)
                        .appFont(.system(size: 13))
                        .foregroundStyle(theme.danger)
                        .accessibilityAddTraits(.isStaticText)
                }

                Section {
                    ForEach(results) { conversation in
                        row(conversation)
                    }
                    if results.isEmpty, !chat.conversations.isEmpty {
                        Text(HistorySearch.noMatches(query))
                            .appFont(.system(size: 13))
                            .foregroundStyle(theme.textMuted)
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
            .conversationActions(actions, chat: chat)
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
                        .appFont(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.accent)
                }
            }
            .contentShape(.rect)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                actions.requestDelete(conversation)
            } label: {
                Label("Delete", systemImage: "trash")
            }
            .accessibilityLabel("Delete \(HistorySearch.displayTitle(conversation))")
            Button {
                actions.startRename(conversation)
            } label: {
                Label("Rename", systemImage: "pencil")
            }
            .tint(theme.accent)
            .accessibilityLabel("Rename \(HistorySearch.displayTitle(conversation))")
        }
        .contextMenu {
            Button {
                actions.startRename(conversation)
            } label: {
                Label("Rename", systemImage: "pencil")
            }
            Button(role: .destructive) {
                actions.requestDelete(conversation)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }
}
