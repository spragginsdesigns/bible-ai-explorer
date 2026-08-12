import SwiftUI

/// Menu bar commands. These are the affordance a Mac app is expected to have and
/// a phone app cannot: real menus, discoverable shortcuts, and a Help entry.
struct AppCommands: Commands {
    var app: AppModel?

    var body: some Commands {
        // Replace the stock "New" item rather than adding a second one.
        CommandGroup(replacing: .newItem) {
            Button("New Chat") {
                app?.section = .chat
                app?.chat.newConversation()
            }
            .keyboardShortcut("n")
            .disabled(app == nil)
        }

        CommandMenu("Chat") {
            Button("Conversation History…") {
                app?.chat.isHistoryPresented = true
            }
            .keyboardShortcut("k")

            Button("Stop Generating") {
                app?.chat.stop()
            }
            .keyboardShortcut(".", modifiers: .command)
            .disabled(app?.chat.isBusy != true)

            Divider()

            Button("Delete Conversation") {
                guard let app, let id = app.chat.activeConversationID else { return }
                Task { await app.chat.deleteConversation(id) }
            }
            .disabled(app?.chat.activeConversationID == nil)
        }

        CommandGroup(after: .sidebar) {
            Divider()
            ForEach(Array(AppSection.allCases.enumerated()), id: \.element) { index, section in
                Button(section.title) { app?.section = section }
                    .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")))
            }
            Divider()
        }

        CommandGroup(replacing: .help) {
            Link("SureWord on the web", destination: Config.apiURL)
        }
    }
}
