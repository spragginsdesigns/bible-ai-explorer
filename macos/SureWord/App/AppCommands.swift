import SwiftUI

/// Menu bar commands. These are the affordance a Mac app is expected to have and
/// a phone app cannot: real menus, discoverable shortcuts, and a Help entry.
struct AppCommands: Commands {
    var app: AppModel?

    var body: some Commands {
        // The settings UI is a sheet, not a Settings scene, so the standard
        // App menu item (and the ⌘, the sidebar gear's tooltip promises) has
        // to be provided explicitly.
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") {
                app?.isSettingsPresented = true
            }
            .keyboardShortcut(",")
            .disabled(app == nil)
        }

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

            // Asks first, through the chat's own `/clear` confirmation.
            Button("Delete Conversation…") {
                guard let app, app.chat.activeConversationID != nil else { return }
                app.section = .chat
                app.chat.isClearConfirmationPresented = true
            }
            // The confirmation lives on the chat, which a sheet would cover.
            .disabled(
                app?.chat.activeConversationID == nil
                    || app?.chat.isHistoryPresented == true
                    || app?.isSettingsPresented == true
            )
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
