import AppKit
import ClerkKit
import ClerkKitUI
import SwiftUI

// `AppSection` lives in `Shared/App/AppModel.swift` — it is shared with iOS.

/// Signed-in shell: sidebar + detail.
struct MainWindow: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    /// The one listener for notification-permission moments, held so the
    /// window can let go of it when the session ends.
    @State private var permissionListener: UUID?
    /// Bumped by a granted dialog, so the reminder sync runs again at once.
    @State private var permissionGrants = 0
    @State private var isOpeningShare = false
    @State private var pendingShareDraft: SharedChatDraft?
    private var updates: MacUpdateCheck { .shared }

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
                .spotlightTarget(app.section.primary.tabTarget)
                .spotlightHost()
                .safeAreaInset(edge: .top, spacing: 0) {
                    if updates.showsBanner, !isGuiding, let release = updates.available {
                        MacUpdateBanner(release: release) { updates.dismissBanner() }
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .primaryAction) { TextSizeQuickButton() }
                    ToolbarItem(placement: .primaryAction) {
                        GuideHelpButton(screen: app.section.primary.helpScreen)
                    }
                }
        }
        .nativeVoiceControls(app: app)
        // Walk with me starts itself once the AI consent sheet is settled.
        .task(id: app.aiConsent.isCurrent && app.aiConsent.prompt == nil) {
            await app.onboarding.autoStartIfNeeded(
                consentSettled: app.aiConsent.isCurrent && app.aiConsent.prompt == nil,
                app: app
            )
        }
        .task { await app.chat.loadConversations() }
        // First hydrate of the session: the server document replaces whatever
        // this Mac had cached for the synced preferences.
        .task { app.preferences.refresh(force: true) }
        // Providers, church and the memory count, warmed for this account so
        // Settings opens on its real content (PRD B7, Android 1.54.0).
        .task { await SettingsDataStore.shared.prefetch(.live(app.api)) }
        // Keep the morning reminder in step with the settings, on every launch
        // and on every change to either half of the preference. Launch never
        // opens the permission dialog (PRD B6a, as on iOS): this only reads
        // the status, and the dialog waits for one of the moments below.
        .task(id: "\(app.settings.verseOfDayEnabled)-\(app.settings.verseOfDayHour)-\(app.settings.notifyChatReplies)-\(permissionGrants)") {
            await MacPushRegistration.syncAll(api: app.api, settings: app.settings, accountID: app.userID)
        }
        .onReceive(NotificationCenter.default.publisher(for: .macPushTokenDidChange)) { _ in
            Task { await MacPushRegistration.syncAll(api: app.api, settings: app.settings, accountID: app.userID) }
        }
        // The one listener for permission moments: a settled chat answer
        // (`ChatViewModel`), the first Daily Cross visit and a Settings switch.
        .onAppear {
            guard permissionListener == nil else { return }
            let settings = app.settings
            permissionListener = NotificationPermissionMoments.shared.subscribe { trigger in
                Task {
                    if await NotificationPermissionCoordinator.handle(trigger, settings: settings) {
                        permissionGrants += 1
                    }
                }
            }
        }
        // The window goes away on sign-out; the next one subscribes afresh.
        .onDisappear {
            if let permissionListener { NotificationPermissionMoments.shared.unsubscribe(permissionListener) }
            permissionListener = nil
        }
        // Once a day at most: is there a newer DMG? Shown as a dismissible
        // bar, never during Walk with me.
        .task { await updates.checkOnLaunchIfDue() }
        // "Your answer is ready" while SureWord is in the background, the Mac's
        // version of the web's hidden-tab notice. Wired here, not in AppModel,
        // because only the Mac posts it; iOS's notice is the server's push.
        .task {
            let settings = app.settings
            let accountID = app.userID
            app.chat.onAnswerReady = { conversationID, title, recovered in
                AnswerReadyNotifier.answerLanded(
                    conversationID: conversationID,
                    title: title,
                    chatReplies: settings.notifyChatReplies,
                    recovered: recovered,
                    accountID: accountID
                )
            }
        }
        // Clicking the morning notification lands here, as does a
        // `sureword://cross` link (buffered in `PendingDeepLinks` first, so
        // it is drained here rather than replayed later).
        .onReceive(NotificationCenter.default.publisher(for: .openDailyCross)) { _ in
            openPendingLinks()
        }
        // `sureword://verse?ref=…`: the reader at that reference.
        .onReceive(NotificationCenter.default.publisher(for: .openVerseReference)) { _ in
            openPendingLinks()
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
            Task { await MacPushRegistration.syncAll(api: app.api, settings: app.settings, accountID: app.userID) }
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
        guard !isOpeningShare, !app.chat.uploadingAttachments else { return }
        isOpeningShare = true
        Task {
            defer { isOpeningShare = false }
            guard await app.noteDeparture.canLeave() else { return }
            if pendingShareDraft == nil {
                pendingShareDraft = await MacShareInbox.shared.takeDraft()
            }
            guard await app.noteDeparture.canLeave(), let draft = pendingShareDraft else { return }
            app.isSettingsPresented = false
            app.chat.isHistoryPresented = false
            app.section = .chat
            pendingShareDraft = nil
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
        Task {
            guard await app.noteDeparture.canLeave() else { return }
            applyPendingLinks()
        }
    }

    private func applyPendingLinks() {
        for link in PendingDeepLinks.shared.drain() {
            switch link {
            case .chat(let conversationID): openConversation(conversationID)
            case .cross:
                app.isSettingsPresented = false
                app.section = .cross
            case .verse(let reference):
                // Resolution is the reader's job, but an unresolvable link is
                // dropped here, as iOS and Android drop it, rather than
                // switching to an unchanged reader.
                guard Bible.resolveReference(reference) != nil else { continue }
                app.isSettingsPresented = false
                app.section = .bible
                app.pendingVerseReference = reference
            }
        }
    }

    /// Walk with me is running (starting, its welcome chat open this session,
    /// or a spotlight lit), or the AI consent sheet is up: nothing else may
    /// ask for attention over it, the update notice included.
    private var isGuiding: Bool {
        let onboarding = app.onboarding
        return onboarding.isStarting || onboarding.welcomeConversationID != nil
            || onboarding.spotlight != nil || app.aiConsent.prompt != nil
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
    @Environment(Clerk.self) private var clerk

    /// Searches Recents by title, as Android's history modal and the web
    /// sidebar's "Search chats" do.
    @State private var query = ""
    @State private var actions = ConversationActions()
    @State private var rememberedAccountID: String?
    @State private var rememberedAccountName = "Your account"

    var body: some View {
        @Bindable var app = app
        let results = HistorySearch.filter(app.chat.conversations, query: query)

        VStack(spacing: 0) {
            sidebarHeader

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
                                .appFont(.system(size: 12))
                                .foregroundStyle(theme.danger)
                        }
                        ForEach(results) { conversation in
                            ConversationRow(conversation: conversation, actions: actions)
                        }
                        if results.isEmpty {
                            Text(HistorySearch.noMatches(query))
                                .appFont(.system(size: 12))
                                .foregroundStyle(theme.textMuted)
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .searchable(text: $query, placement: .sidebar, prompt: "Search conversations")
            .conversationActions(actions, chat: app.chat)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()

            accountFooter
        }
        .background(theme.bgElevated)
        .onChange(of: currentAccountName, initial: true) { _, name in
            guard let name else { return }
            rememberedAccountID = app.userID
            rememberedAccountName = name
        }
    }

    private var sidebarHeader: some View {
        HStack {
            BrandMark(size: 22)
            Spacer()
            Button {
                app.section = .chat
                app.chat.newConversation()
            } label: {
                Image(systemName: "square.and.pencil")
                    .frame(width: 20, height: 28)
            }
            .buttonStyle(SubtleButtonStyle())
            .help("New chat (⌘N)")
            .accessibilityLabel("New chat")
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.xs)
        .background(theme.bgElevated)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// A sibling of the scrolling List, so even its last row and overscroll
    /// stay above the account controls. bgElevated is opaque; surface is glass.
    private var accountFooter: some View {
        VStack(spacing: 0) {
            Rectangle().fill(theme.border).frame(height: 1)
            HStack(spacing: Spacing.sm) {
                // Keep Clerk's profile, account switcher and session-task
                // handling. Its default signedOutContent is EmptyView.
                UserButton(signedOutContent: {
                    Image(systemName: "person.crop.circle.fill")
                        .resizable()
                        .scaledToFit()
                        .foregroundStyle(theme.textMuted)
                        .frame(width: 36, height: 36)
                        .accessibilityLabel("Account is refreshing")
                })
                // Clerk's button is 36pt internally. Scale that actual button
                // to a 44pt target rather than padding an inactive wrapper.
                .scaleEffect(44.0 / 36.0)
                .frame(width: 44, height: 44)
                .help("Open account")

                Text(displayedAccountName)
                    .appFont(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    app.isSettingsPresented = true
                } label: {
                    Image(systemName: "gearshape")
                        .frame(width: 20, height: 28)
                }
                .buttonStyle(SubtleButtonStyle())
                .help("Settings (⌘,)")
                .accessibilityLabel("Settings")
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .frame(minHeight: 64)
        }
        .background(theme.bgElevated)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var currentAccountName: String? {
        guard let user = clerk.user, user.id == app.userID else { return nil }
        let name = [user.firstName, user.lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if !name.isEmpty { return name }
        for value in [user.username, user.primaryEmailAddress?.emailAddress] {
            if let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty { return value }
        }
        return nil
    }

    private var displayedAccountName: String {
        currentAccountName ?? (rememberedAccountID == app.userID ? rememberedAccountName : "Your account")
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
                .appFont(.system(size: 15))
                .padding(Spacing.lg)

            Divider().overlay(theme.border)

            if let error = actions.error {
                Text(error)
                    .appFont(.system(size: 12))
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
                    .appFont(.system(size: 18, weight: .semibold))
                    .foregroundStyle(theme.text)
                Text(detail)
                    .appFont(.system(size: 13))
                    .foregroundStyle(theme.textMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 380)
            }
        }
    }
}
