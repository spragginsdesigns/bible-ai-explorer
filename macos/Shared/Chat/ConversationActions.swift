import SwiftUI

/// Rename and confirmed delete for one list of conversations: the iOS history
/// sheet, and the Mac's sidebar Recents and history picker. Each list owns one
/// of these and attaches `.conversationActions(_:chat:)`.
///
/// Android reveals Rename and Delete by swiping a row, with a second tap on
/// Delete ("Sure?") as the confirmation; the web sidebar asks "Sure?" the same
/// way. Here Delete asks once through a confirmation dialog, and Rename edits
/// the title in an alert. Deleting the conversation that is open starts a new
/// chat (`ChatViewModel.deleteConversation`).
@MainActor
@Observable
final class ConversationActions {
    /// The row whose delete is waiting on the confirmation.
    var pendingDelete: Conversation?
    /// The row whose title is being edited.
    var renaming: Conversation?
    var renameValue = ""
    /// Android's error line under the search box ("Couldn't rename. Try again.").
    var error: String?

    func startRename(_ conversation: Conversation) {
        error = nil
        renameValue = conversation.title
        renaming = conversation
    }

    func requestDelete(_ conversation: Conversation) {
        pendingDelete = conversation
    }
}

extension View {
    /// Presents the delete confirmation and the rename alert for `actions`.
    func conversationActions(_ actions: ConversationActions, chat: ChatViewModel) -> some View {
        modifier(ConversationActionsModifier(actions: actions, chat: chat))
    }

    /// Presents `ChatViewModel.historyAlert` (a delete the server refused) and
    /// clears it on dismissal. Attached to the history list and to the chat
    /// behind it, so it shows whichever of the two is in front.
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

private struct ConversationActionsModifier: ViewModifier {
    @Bindable var actions: ConversationActions
    let chat: ChatViewModel

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                ConversationDeletion.title,
                isPresented: Binding(
                    get: { actions.pendingDelete != nil },
                    set: { if !$0 { actions.pendingDelete = nil } }
                ),
                titleVisibility: .visible,
                presenting: actions.pendingDelete
            ) { conversation in
                Button("Delete", role: .destructive) {
                    actions.pendingDelete = nil
                    Task { await chat.deleteConversation(conversation.id) }
                }
                Button("Cancel", role: .cancel) { actions.pendingDelete = nil }
            } message: { conversation in
                Text(ConversationDeletion.message(for: conversation))
            }
            .alert(
                "Rename conversation",
                isPresented: Binding(
                    get: { actions.renaming != nil },
                    set: { if !$0 { actions.renaming = nil } }
                ),
                presenting: actions.renaming
            ) { conversation in
                TextField("Title", text: $actions.renameValue)
                    .onChange(of: actions.renameValue) { _, value in
                        let clamped = ConversationRename.clamped(value)
                        if clamped != value { actions.renameValue = clamped }
                    }
                    .accessibilityLabel("Rename conversation")
                Button("Save") { commitRename(conversation) }
                Button("Cancel", role: .cancel) { actions.renaming = nil }
            }
    }

    private func commitRename(_ conversation: Conversation) {
        let value = actions.renameValue
        actions.renaming = nil
        Task {
            let message = await chat.renameConversation(conversation.id, to: value)
            actions.error = message
            #if os(macOS)
            // The web sidebar's error fades after three seconds; the Mac's
            // sidebar never closes, so it would otherwise stay for good. The
            // iOS sheet keeps it until it closes, as Android's modal does.
            guard let message else { return }
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
            if actions.error == message { actions.error = nil }
            #endif
        }
    }
}
