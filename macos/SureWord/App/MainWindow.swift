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
        // Keep the morning reminder in step with the settings, on every launch
        // and on every change to either half of the preference.
        .task(id: "\(app.settings.verseOfDayEnabled)-\(app.settings.verseOfDayHour)") {
            await DailyCrossNotifications.sync(
                enabled: app.settings.verseOfDayEnabled,
                hour: app.settings.verseOfDayHour
            )
        }
        // Clicking the morning notification lands here.
        .onReceive(NotificationCenter.default.publisher(for: .openDailyCross)) { _ in
            app.section = .cross
        }
        // A preference changed on the phone or the web should be here by the
        // time the window is looked at again. `refresh` throttles itself, which
        // matters on macOS: clicking back into the app fires this constantly.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            app.preferences.refresh()
        }
        .preferencesErrorAlert(app.preferences, isActive: !app.isSettingsPresented)
        .sheet(isPresented: $chat.isHistoryPresented) {
            HistoryPicker()
        }
        .sheet(isPresented: $app.isSettingsPresented) {
            SettingsView()
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch app.section {
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
                app.pendingVerseReference = verse.reference
            }
            .navigationTitle(app.chat.activeConversation?.title ?? "New chat")
        case .bible:
            BibleSection()
        case .notes:
            NotesSection(api: app.api)
        case .cross:
            DailyCrossView()
        }
    }
}

// MARK: - Sidebar

struct Sidebar: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app

        List(selection: $app.section) {
            Section {
                ForEach(AppSection.allCases) { section in
                    Label(section.title, systemImage: section.symbol)
                        .tag(section)
                }
            }

            if !app.chat.conversations.isEmpty {
                Section("Recent") {
                    ForEach(app.chat.conversations) { conversation in
                        ConversationRow(conversation: conversation)
                    }
                }
            }
        }
        .listStyle(.sidebar)
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

    var body: some View {
        Button {
            app.section = .chat
            Task { await app.chat.switchConversation(to: conversation.id) }
        } label: {
            Text(conversation.title)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .fontWeight(app.chat.activeConversationID == conversation.id ? .semibold : .regular)
        .contextMenu {
            Button("Delete", role: .destructive) {
                Task { await app.chat.deleteConversation(conversation.id) }
            }
        }
    }
}

// MARK: - History picker

struct HistoryPicker: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""

    private var results: [Conversation] {
        guard !query.isEmpty else { return app.chat.conversations }
        return app.chat.conversations.filter {
            $0.title.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            TextField("Search conversations…", text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .padding(Spacing.lg)

            Divider().overlay(theme.border)

            List(results) { conversation in
                Button {
                    app.section = .chat
                    Task { await app.chat.switchConversation(to: conversation.id) }
                    dismiss()
                } label: {
                    Text(conversation.title)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
            .listStyle(.inset)

            Divider().overlay(theme.border)

            HStack {
                Button("Clear all", role: .destructive) {
                    Task { await app.chat.clearAllConversations() }
                    dismiss()
                }
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(Spacing.md)
        }
        .frame(width: 520, height: 420)
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
