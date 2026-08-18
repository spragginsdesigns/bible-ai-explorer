import SwiftUI

/// Conversation history, as a sheet — the iOS counterpart of the Mac's
/// `HistoryPicker` and Android's `HistoryModal`. Switch, swipe-to-delete,
/// clear-all (confirmed), and a new-chat row up top.
struct ChatHistorySheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Bindable var chat: ChatViewModel

    @State private var query = ""
    @State private var confirmClearAll = false

    private var results: [Conversation] {
        guard !query.isEmpty else { return chat.conversations }
        return chat.conversations.filter {
            $0.title.localizedCaseInsensitiveContains(query)
        }
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

                Section {
                    ForEach(results) { conversation in
                        Button {
                            Task { await chat.switchConversation(to: conversation.id) }
                            dismiss()
                        } label: {
                            HStack {
                                Text(conversation.title)
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
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                Task { await chat.deleteConversation(conversation.id) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
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
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
