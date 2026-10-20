import AppKit
import ClerkKit
import ClerkKitUI
import SwiftUI

// `AppSection` lives in `Shared/App/AppModel.swift` — it is shared with iOS.

/// Signed-in shell: sidebar + detail.
struct MainWindow: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        // `chat` is a `let` on AppModel, so its bindings come from binding the
        // chat model itself rather than a key path through `app`.
        @Bindable var chat = app.chat

        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 320)
        } detail: {
            detail
        }
        .task { await app.chat.loadConversations() }
        // First hydrate of the session: the server document replaces whatever
        // this Mac had cached for the synced preferences.
        .task { app.preferences.refresh(force: true) }
        // Providers, church and the memory count, warmed for this account so
        // Settings opens on its real content (PRD B7, Android 1.54.0).
        .task { await SettingsDataStore.shared.prefetch(.live(app.api)) }
        // Keep the morning reminder in step with the settings, on every launch
        // and on every change to either half of the preference.
        .task(id: "\(app.settings.verseOfDayEnabled)-\(app.settings.verseOfDayHour)") {
            await DailyCrossNotifications.sync(
                enabled: app.settings.verseOfDayEnabled,
                hour: app.settings.verseOfDayHour
            )
        }
        // "Your answer is ready" while SureWord is in the background, the Mac's
        // version of the web's hidden-tab notice. Wired here, not in AppModel,
        // because only the Mac posts it; iOS's notice is the server's push.
        .task {
            let settings = app.settings
            app.chat.onAnswerReady = { conversationID, title in
                AnswerReadyNotifier.answerLanded(
                    conversationID: conversationID,
                    title: title,
                    chatReplies: settings.notifyChatReplies
                )
            }
        }
        // Clicking the morning notification lands here.
        .onReceive(NotificationCenter.default.publisher(for: .openDailyCross)) { _ in
            app.section = .cross
        }
        // Clicking "Your answer is ready" lands here, or, when the click
        // launched the app, in the buffer drained once this window appears.
        .onReceive(NotificationCenter.default.publisher(for: .openConversation)) { _ in
            openPendingLinks()
        }
        .task { openPendingLinks() }
        // "Share into SureWord" (Services, or a drop on the window or the Dock
        // icon; `MacShareInbox`). This shell only exists signed in, so a share
        // made signed out waits in the inbox and opens right after sign-in.
        .task { openPendingShare() }
        .onReceive(NotificationCenter.default.publisher(for: .pendingShareArrived)) { _ in
            openPendingShare()
        }
        // An upload already running would make the share's upload bail out,
        // so a share that arrived mid-upload opens once it finishes.
        .onChange(of: app.chat.uploadingAttachments) { _, uploading in
            if !uploading { openPendingShare() }
        }
        // A preference changed on the phone or the web should be here by the
        // time the window is looked at again. `refresh` throttles itself, which
        // matters on macOS: clicking back into the app fires this constantly.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            app.preferences.refresh()
        }
        .preferencesErrorAlert(app.preferences, isActive: !app.isSettingsPresented)
        // A delete the server refused (the history picker shows its own while
        // it is up).
        .historyAlert(chat, isActive: !chat.isHistoryPresented)
        .sheet(isPresented: $chat.isHistoryPresented) {
            HistoryPicker()
        }
        .sheet(isPresented: $app.isSettingsPresented) {
            SettingsView()
        }
        // `screen_viewed` for the section in front, and again when Settings
        // closes over it. Android reports the same tab routes.
        .onChange(of: app.section, initial: true) { _, section in
            Analytics.shared.screen(AnalyticsScreen.pattern(for: section))
        }
        .onChange(of: app.isSettingsPresented) { _, presented in
            if !presented { Analytics.shared.screen(AnalyticsScreen.pattern(for: app.section)) }
        }
    }

    /// Open the waiting share, if any, as a new chat (the iOS shell's
    /// `openPendingShare`). Taking it empties the inbox, so it is applied once.
    private func openPendingShare() {
        guard !app.chat.uploadingAttachments else { return }
        Task {
            guard let draft = await MacShareInbox.shared.takeDraft() else { return }
            app.isSettingsPresented = false
            app.chat.isHistoryPresented = false
            app.section = .chat
            await app.chat.startSharedChat(draft)
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch app.section {
        case .today:
            TodaySection()
        case .connections:
            ConnectionsMapView()
        case .study:
            StudySection()
        case .chat:
            ChatView(
                chat: app.chat,
                api: app.api,
                suggested: app.suggestedQuestions,
                // The day the assistant just replaced is stale in the cached
                // model, so force a reload on the way in.
                onOpenCross: {
                    app.section = .cross
                    app.dailyCross.load(force: true)
                },
                onCrossReplaced: { app.dailyCross.invalidate() }
            ) { verse in
                app.section = .bible
                app.pendingVerseTranslation = verse.translation
                app.pendingVerseReference = verse.reference
            }
            .navigationTitle(app.chat.activeConversation?.title ?? "New chat")
        case .bible:
            BibleSection()
        case .notes:
            NotesSection(api: app.api)
                .toolbar { Button("Back to Study", systemImage: "chevron.left") { app.section = .study } }
        case .cross:
            DailyCrossView()
                .toolbar { Button("Back to Today", systemImage: "chevron.left") { app.section = .today } }
        }
    }

    /// Handles everything `PendingDeepLinks` holds. Draining on the live
    /// notification too (not only on appearance, as the iOS shell does) means
    /// a click opens its conversation once and is never replayed into a later
    /// window or a later account.
    private func openPendingLinks() {
        for link in PendingDeepLinks.shared.drain() {
            switch link {
            case .chat(let conversationID): openConversation(conversationID)
            case .cross: app.section = .cross
            case .verse(let reference):
                app.section = .bible
                app.pendingVerseReference = reference
            }
        }
    }

    /// Android's `router.push("/", { conversationId })` for a chat push tap,
    /// as on iOS (`TabShell.openConversation`).
    private func openConversation(_ id: String) {
        guard !id.isEmpty else { return }
        app.isSettingsPresented = false
        app.chat.isHistoryPresented = false
        app.section = .chat
        Task { await app.chat.switchConversation(to: id) }
    }
}

// MARK: - Sidebar

struct Sidebar: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    /// Searches Recents by title, as Android's history modal and the web
    /// sidebar's "Search chats" do.
    @State private var query = ""
    @State private var actions = ConversationActions()

    var body: some View {
        @Bindable var app = app
        let results = HistorySearch.filter(app.chat.conversations, query: query)

        List(selection: Binding(get: { app.section.primary }, set: { app.section = $0 })) {
            Section {
                ForEach(AppSection.allCases) { section in
                    Label(section.title, systemImage: section.symbol)
                        .tag(section)
                }
            }

            Section("Study") {
                Button { app.section = .notes } label: { Label("Notes", systemImage: "note.text") }
                    .buttonStyle(.plain)
            }

            if !app.chat.conversations.isEmpty {
                Section("Recent") {
                    if let error = actions.error {
                        Text(error)
                            .font(.system(size: 12))
                            .foregroundStyle(theme.danger)
                    }
                    ForEach(results) { conversation in
                        ConversationRow(conversation: conversation, actions: actions)
                    }
                    if results.isEmpty {
                        Text(HistorySearch.noMatches(query))
                            .font(.system(size: 12))
                            .foregroundStyle(theme.textMuted)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .searchable(text: $query, placement: .sidebar, prompt: "Search conversations")
        .conversationActions(actions, chat: app.chat)
        .safeAreaInset(edge: .top) {
            HStack {
                BrandMark(size: 22)
                Spacer()
                Button {
                    app.section = .chat
                    app.chat.newConversation()
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .buttonStyle(SubtleButtonStyle())
                .help("New chat (⌘N)")
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
        }
        .safeAreaInset(edge: .bottom) {
            HStack {
                UserButton()
                Spacer()
                Button {
                    app.isSettingsPresented = true
                } label: {
                    Image(systemName: "gearshape")
                }
                .buttonStyle(SubtleButtonStyle())
                .help("Settings (⌘,)")
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
        }
    }
}

private struct ConversationRow: View {
    @Environment(AppModel.self) private var app
    let conversation: Conversation
    let actions: ConversationActions

    var body: some View {
        Button {
            app.section = .chat
            Task { await app.chat.switchConversation(to: conversation.id) }
        } label: {
            Text(HistorySearch.displayTitle(conversation))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .fontWeight(app.chat.activeConversationID == conversation.id ? .semibold : .regular)
        .contextMenu { ConversationMenu(conversation: conversation, actions: actions) }
    }
}

/// Rename and Delete for one conversation, in a row's context menu. Both open
/// the shared `ConversationActions` dialogs; nothing is deleted from here.
private struct ConversationMenu: View {
    let conversation: Conversation
    let actions: ConversationActions

    var body: some View {
        Button("Rename…") { actions.startRename(conversation) }
        Button("Delete…", role: .destructive) { actions.requestDelete(conversation) }
    }
}

// MARK: - History picker

struct HistoryPicker: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var confirmClearAll = false
    @State private var actions = ConversationActions()

    private var results: [Conversation] {
        HistorySearch.filter(app.chat.conversations, query: query)
    }

    var body: some View {
        VStack(spacing: 0) {
            TextField("Search conversations…", text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .padding(Spacing.lg)

            Divider().overlay(theme.border)

            if let error = actions.error {
                Text(error)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.top, Spacing.sm)
            }

            List {
                ForEach(results) { conversation in
                    Button {
                        app.section = .chat
                        Task { await app.chat.switchConversation(to: conversation.id) }
                        dismiss()
                    } label: {
                        Text(HistorySearch.displayTitle(conversation))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .contextMenu { ConversationMenu(conversation: conversation, actions: actions) }
                }
                if results.isEmpty, !app.chat.conversations.isEmpty {
                    Text(HistorySearch.noMatches(query))
                        .foregroundStyle(theme.textMuted)
                }
            }
            .listStyle(.inset)

            Divider().overlay(theme.border)

            HStack {
                Button("Clear all", role: .destructive) {
                    confirmClearAll = true
                }
                .disabled(app.chat.conversations.isEmpty)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(Spacing.md)
        }
        .frame(width: 520, height: 420)
        .conversationActions(actions, chat: app.chat)
        // The iOS sheet's alert, so Clear all asks first on both.
        .alert("Clear all conversations?", isPresented: $confirmClearAll) {
            Button("Clear all", role: .destructive) {
                Task { await app.chat.clearAllConversations() }
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every conversation will be deleted. This cannot be undone.")
        }
        .historyAlert(app.chat)
    }
}

// MARK: - Placeholder

struct PlaceholderPane: View {
    @Environment(\.theme) private var theme
    let title: String
    let detail: String

    var body: some View {
        ZStack {
            MeshBackground()
            VStack(spacing: Spacing.sm) {
                Text(title)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(theme.text)
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 380)
            }
        }
    }
}
