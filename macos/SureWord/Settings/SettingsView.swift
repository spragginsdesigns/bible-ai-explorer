import ClerkKit
import SwiftUI

/// Settings, laid out like the Mac's own System Settings: a searchable sidebar
/// of categories on the left and one page at a time on the right. The
/// categories and what sits on each page follow Android's settings hub
/// (`mobile/app/(app)/settings/index.tsx`): the account row on top, then Study,
/// Assistant and App.
struct SettingsView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(Clerk.self) private var clerk

    /// The page last opened, so Settings reopens where the reader left it.
    @AppStorage("settings.mac.pane") private var savedPane = SettingsPane.appearance.rawValue
    @State private var selection: SettingsPane? = nil
    @State private var search = ""

    @State private var isConfirmingSignOut = false
    @State private var isMemoriesPresented = false
    @State private var isWhatsNewPresented = false
    /// Owned here rather than in the sheet so the saved count stays truthful
    /// after the sheet adds or deletes something.
    @State private var memory = MemoriesModel()
    /// Owned here for the same reason as `memory`: the section is drawn inline,
    /// but the model must outlive a redraw so a save or removal is not re-run.
    @State private var church = ChurchModel()
    /// Same reason again: a revoke in flight must survive a redraw, or the optimistic
    /// row would snap back while its DELETE is still going.
    @State private var shares = SharedAnswersModel()
    /// Cards you sent, owned here for the same reason as `shares`.
    @State private var sentCards = SentCardsModel()

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                sidebar
                    .frame(width: 236)
                Divider().overlay(theme.border)
                detail
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            Divider().overlay(theme.border)

            HStack {
                Text("Changes save as you make them.")
                    .appFont(.system(size: 11))
                    .foregroundStyle(theme.textFaint)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
        }
        .frame(width: 860, height: 640)
        .spotlightHost()
        .onAppear {
            if selection == nil {
                selection = SettingsPane(rawValue: savedPane) ?? .appearance
            }
        }
        // Walk with me asked for a place in Settings: open its page.
        .onChange(of: app.onboarding.pendingSettingsTarget, initial: true) { _, target in
            switch target {
            case .settingsChurch: selection = .church
            case .settingsTextSize: selection = .appearance
            default: return
            }
            search = ""
            app.onboarding.consumeSettingsTarget()
        }
        .onChange(of: selection) { _, pane in
            if let pane { savedPane = pane.rawValue }
        }
        .onChange(of: search) { _, _ in
            // Keep the page in view in step with the search: if the open page
            // no longer matches, jump to the first one that does.
            let matches = visiblePanes
            if let selection, matches.contains(selection) { return }
            if let first = matches.first { selection = first }
        }
        .task {
            memory.configure(app.api)
            await memory.load()
        }
        .onChange(of: app.preferences.memoryEnabled) { _, enabled in
            // A hydrate on sign-in or foreground can bring back a Memory change
            // made on another client while this screen is already open.
            if let enabled { memory.applyRemote(enabled: enabled) }
        }
        .task {
            church.configure(app.api)
            await church.load()
        }
        .task {
            shares.configure(app.api)
            await shares.load()
        }
        .task {
            sentCards.configure(app.api)
            await sentCards.load()
        }
        .sheet(isPresented: $isMemoriesPresented) {
            MemoriesView(model: memory)
                .analyticsScreen(AnalyticsScreen.memories)
                .onDisappear { Analytics.shared.screen(AnalyticsScreen.settings) }
        }
        // Android's Settings -> APP -> What's new row; a sheet here because
        // Settings is itself a sheet on the Mac. "Try it" closes Settings first.
        .sheet(isPresented: $isWhatsNewPresented) {
            NavigationStack {
                WhatsNewView(api: app.api) { destination in
                    isWhatsNewPresented = false
                    app.isSettingsPresented = false
                    WhatsNewNavigation.open(destination, in: app)
                }
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { isWhatsNewPresented = false }
                    }
                }
            }
            .frame(width: 560, height: 680)
            .onDisappear { Analytics.shared.screen(AnalyticsScreen.settings) }
        }
        .analyticsScreen(AnalyticsScreen.settings)
        .memoryErrorAlert(memory, isActive: !isMemoriesPresented)
        .preferencesErrorAlert(app.preferences, isActive: !isMemoriesPresented)
        .confirmationDialog(
            "Sign out of SureWord?",
            isPresented: $isConfirmingSignOut,
            titleVisibility: .visible
        ) {
            Button("Sign out", role: .destructive) {
                Task {
                    await ClerkAuth.signOut()
                    dismiss()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You can sign back in at any time.")
        }
    }

    // MARK: - Sidebar

    /// Every page this account can open. My church drops out, like its
    /// Android row, when the server has no Places key.
    private var availablePanes: [SettingsPane] {
        SettingsPane.allCases.filter { $0 != .church || church.state != .unavailable }
    }

    private var visiblePanes: [SettingsPane] {
        availablePanes.filter { $0.matches(search) }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .appFont(.system(size: 11, weight: .medium))
                    .foregroundStyle(theme.textFaint)
                TextField("Search settings", text: $search)
                    .textFieldStyle(.plain)
                    .appFont(.system(size: 12))
                    .onSubmit {
                        if let first = visiblePanes.first { selection = first }
                    }
                if !search.isEmpty {
                    Button {
                        search = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(theme.textFaint)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(theme.surfaceStrong, in: RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(theme.border))
            .padding(.horizontal, Spacing.md)
            .padding(.top, Spacing.md)
            .padding(.bottom, Spacing.sm)

            List(selection: $selection) {
                let panes = visiblePanes
                if panes.contains(.account) {
                    accountRow.tag(SettingsPane.account)
                }
                ForEach(SettingsPane.Group.allCases, id: \.self) { group in
                    let rows = panes.filter { $0.group == group }
                    if !rows.isEmpty {
                        Section(group.title) {
                            ForEach(rows) { pane in
                                SettingsSidebarRow(pane: pane).tag(pane)
                            }
                        }
                    }
                }
                if panes.isEmpty {
                    Text("No settings match \u{201C}\(search)\u{201D}.")
                        .appFont(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                        .selectionDisabled()
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
        .background(theme.bgElevated)
    }

    private var accountRow: some View {
        HStack(spacing: 10) {
            avatar(size: 34)
            VStack(alignment: .leading, spacing: 1) {
                Text(accountName ?? accountEmail ?? "Signed in")
                    .appFont(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text(accountName == nil ? "SureWord account" : (accountEmail ?? "SureWord account"))
                    .appFont(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("settings.pane.account")
    }

    private func avatar(size: CGFloat) -> some View {
        let initial = (accountName ?? accountEmail ?? "S").prefix(1).uppercased()
        return ZStack {
            Circle().fill(theme.accentSoft)
            Text(initial)
                .appFont(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(theme.accent)
            if let url = clerk.user.flatMap({ URL(string: $0.imageUrl) }) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.clear
                }
                .clipShape(Circle())
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(theme.accentBorder))
        .accessibilityHidden(true)
    }

    // MARK: - Detail

    @ViewBuilder
    private var detail: some View {
        let pane = selection ?? .appearance
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: Spacing.md) {
                if pane == .account {
                    avatar(size: 44)
                } else {
                    SettingsIconTile(pane: pane, size: 36)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(pane.title)
                        .appFont(.system(size: 20, weight: .bold))
                        .foregroundStyle(theme.text)
                    Text(pane.summary)
                        .appFont(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 28)
            .padding(.top, 22)
            .padding(.bottom, 4)
            .spotlightTarget(.settingsChurch, isActive: pane == .church)

            page(pane)
                .id(pane)
        }
        .background(theme.bg)
    }

    @ViewBuilder
    private func page(_ pane: SettingsPane) -> some View {
        switch pane {
        case .feedback:
            // Its own Form, so it gets the page to itself.
            FeedbackView(api: app.api)
                .formStyle(.grouped)
                .scrollContentBackground(.hidden)
        default:
            Form {
                sections(for: pane)
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
        }
    }

    @ViewBuilder
    private func sections(for pane: SettingsPane) -> some View {
        @Bindable var settings = app.settings

        switch pane {
        case .account:
            Section("Signed in") {
                if let name = accountName {
                    LabeledContent("Name", value: name)
                }
                if let email = accountEmail {
                    LabeledContent("Email", value: email)
                }
            }
            Section {
                Button("Sign out", role: .destructive) { isConfirmingSignOut = true }
                DeleteAccountRow(app: app) { dismiss() }
            }

        case .appearance:
            Section("Appearance") {
                Picker("Theme", selection: $settings.appearance) {
                    ForEach(AppearanceSetting.allCases, id: \.self) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                hint("System follows your Mac's dark or light mode.")
                Toggle("Parchment page", isOn: $settings.parchment)
                hint("Read Scripture on a parchment sheet, light or dark with the theme.")
            }

            Section("Text size") {
                TextSizeControls().spotlightTarget(.settingsTextSize)
            }

            Section("Bible") {
                // A menu, not segments: the Spanish and German Bibles show
                // their full name and language, which five segments cannot fit.
                Picker("Default translation", selection: $settings.translation) {
                    ForEach(TranslationID.allCases, id: \.self) { option in
                        Text(option.pickerLabel).tag(option)
                    }
                }
                hint(
                    "Used by the Bible reader and verse attachments. \(settings.translation.copyright). "
                        + "SureWord's AI answers use the translation you select."
                )
                Toggle("Offer a quiz after each chapter", isOn: $settings.offerQuiz)
                hint("A short, optional quiz at the end of each chapter. Every answer comes with its verse.")
            }

        case .language:
            Section("SureWord answers in") {
                Picker(
                    "SureWord answers in",
                    selection: Binding(
                        get: { settings.answerLanguage },
                        set: { settings.chooseAnswerLanguage($0) }
                    )
                ) {
                    ForEach(AnswerLanguageSetting.allCases) { option in
                        Text(option.label()).tag(option)
                    }
                }
                hint(AnswerLanguageSetting.hint)
            }

        case .highlights:
            HighlightLabelsSection(settings: app.settings, preferences: app.preferences)

        case .church:
            churchSection

        case .serve:
            ServeSettingsSection {
                LabeledContent("Today's way, nearby search and your journal") {
                    Button("Open Ways to Serve") {
                        // Settings is a sheet on the Mac; close it so the
                        // page opens in the main window behind it.
                        app.isSettingsPresented = false
                        app.pendingDailyDestination = .serve
                        app.section = .today
                    }
                }
            }

        case .memory:
            memorySection
            AboutMeSection(settings: app.settings, preferences: app.preferences)
            TestimonySection(settings: app.settings, preferences: app.preferences)

        case .ai:
            MembershipSection(api: app.api)
            WebSearchSection(preferences: app.preferences)
            AIConsentSettingsSection(store: app.aiConsent)

        case .shared:
            sharedAnswersSection
            SentCardsSectionView(model: sentCards)

        case .notifications:
            chatNotificationSection
            verseOfDaySection

        case .feedback:
            EmptyView()

        case .about:
            Section {
                LabeledContent("Version", value: Config.appVersion)
                LabeledContent("What's new") {
                    Button("Release notes…") { isWhatsNewPresented = true }
                }
            }
            Section("Walk with me") {
                LabeledContent("A short guided start, any time") {
                    Button(app.onboarding.isStarting ? "Starting…" : "Walk me through SureWord") {
                        Task { await app.onboarding.startManually(app: app) }
                    }
                    .disabled(app.onboarding.isStarting)
                }
                if let error = app.onboarding.startError { hint(error) }
            }
            Section("Links") {
                AboutLinkRows()
            }
            Section("Why SureWord") {
                Text("A Bible study assistant rooted in the King James Version.")
                    .appFont(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.text)
                hint(
                    "Ask a generic AI if the Bible is really the Word of God "
                        + "and you'll hear \u{201C}it depends on your viewpoint.\u{201D} SureWord never "
                        + "hedges - it answers as a Bible-believing Christian, standing on Scripture "
                        + "as the inerrant, infallible, final authority for every answer. "
                        + "\u{201C}All scripture is given by inspiration of God\u{201D} - 2 Timothy 3:16."
                )
            }
        }
    }

    // MARK: - Chat

    /// Android's Chat card in Settings → Notifications
    /// (`settings/notifications.tsx`), same switch and copy as there and on
    /// iOS. The Mac registers no push token, so the preference stays on this
    /// Mac like the reminder's and decides the local notice
    /// `AnswerReadyNotifier` posts while SureWord is in the background.
    @ViewBuilder
    private var chatNotificationSection: some View {
        @Bindable var settings = app.settings

        Section("Chat") {
            Toggle("Notify when an answer is ready", isOn: $settings.notifyChatReplies)
            hint(
                "Leave the app while SureWord is answering and it keeps working. "
                    + "This tells you when the answer has landed."
            )
        }
        .onChange(of: settings.notifyChatReplies) { was, now in
            if now, !was { Task { await AnswerReadyNotifier.requestAuthorization() } }
        }
    }

    // MARK: - Verse of the Day

    /// Mirrors Android's "Verse of the Day" card: the reminder toggle and the
    /// hour it arrives. Unlike Android there is no push token to register —
    /// the Mac schedules a local daily reminder and pulls the day when opened
    /// (see `DailyCrossNotifications`).
    @ViewBuilder
    private var verseOfDaySection: some View {
        @Bindable var settings = app.settings

        Section("Verse of the Day") {
            Toggle("Daily verse notification", isOn: $settings.verseOfDayEnabled)
            hint(
                "An AI-picked verse each morning, shaped by what you've been reading and "
                    + "asking about. Pick Up Your Cross is always available in the sidebar."
            )

            if settings.verseOfDayEnabled {
                LabeledContent("Arrives at") {
                    HStack(spacing: Spacing.sm) {
                        Button {
                            settings.verseOfDayHour = (settings.verseOfDayHour + 23) % 24
                        } label: {
                            Text("−").frame(width: 20)
                        }
                        .accessibilityLabel("One hour earlier")

                        Text(SettingsStore.formatHour(settings.verseOfDayHour))
                            .appFont(.system(size: 12, weight: .semibold))
                            .monospacedDigit()
                            .frame(width: 72)

                        Button {
                            settings.verseOfDayHour = (settings.verseOfDayHour + 1) % 24
                        } label: {
                            Text("+").frame(width: 20)
                        }
                        .accessibilityLabel("One hour later")
                    }
                }
            }
        }
    }

    // MARK: - Memory

    /// Mirrors Android's Memory card: the server-side enable flag plus a way in
    /// to the manage screen, labelled with how many memories are stored.
    @ViewBuilder
    private var memorySection: some View {
        Section("Memory") {
            Toggle(
                "Enable memory",
                isOn: Binding(
                    get: { memory.isEnabled ?? false },
                    set: { enabled in
                        Task {
                            await memory.setEnabled(enabled)
                            app.preferences.recordMemoryEnabled(memory.isEnabled)
                        }
                    }
                )
            )
            .disabled(memory.isEnabled == nil || memory.isTogglePending)
            hint("When off, SureWord won't use or save memories. Your saved memories are kept.")

            LabeledContent {
                Button("Manage…") { isMemoriesPresented = true }
            } label: {
                Text("Manage memories")
                Text(memory.hasLoaded && memory.loadError == nil ? "\(memory.memories.count) saved" : "…")
            }
        }
    }

    // MARK: - My church

    /// Mirrors Android's MY CHURCH card and the web settings section. The view
    /// owns its own `Section` so it can vanish entirely, heading and all, when
    /// the server has no Google Places key configured.
    private var churchSection: some View {
        ChurchSectionView(model: church)
    }

    // MARK: - Shared answers

    /// Mirrors the web `/settings` privacy section and the Android Settings
    /// screen: every public link this account has minted, and the way to take
    /// one back. Like My church the view owns its own `Section`.
    private var sharedAnswersSection: some View {
        SharedAnswersSectionView(model: shares)
    }

    /// Android shows the Clerk full name and falls back to the username
    /// (`user?.fullName ?? user?.username`). ClerkKit keeps `fullName`
    /// internal, so it is composed from the two public parts here.
    private var accountName: String? {
        let parts = [clerk.user?.firstName, clerk.user?.lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        let name = parts.joined(separator: " ")
        if !name.isEmpty { return name }
        let username = clerk.user?.username?.trimmingCharacters(in: .whitespaces)
        if let username, !username.isEmpty { return username }
        return nil
    }

    private var accountEmail: String? {
        clerk.user?.primaryEmailAddress?.emailAddress
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .appFont(.system(size: 11))
            .foregroundStyle(theme.textGhost)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Categories

/// One page of Settings. Grouped, named and ordered like Android's hub rows.
enum SettingsPane: String, CaseIterable, Identifiable {
    case account, appearance, language, highlights, church, serve, memory, ai, shared, notifications, feedback, about

    enum Group: CaseIterable {
        case study, assistant, app

        var title: String {
            switch self {
            case .study: "Study"
            case .assistant: "Assistant"
            case .app: "App"
            }
        }
    }

    var id: String { rawValue }

    /// nil for the account row, which sits above the groups.
    var group: Group? {
        switch self {
        case .account: nil
        case .appearance, .language, .highlights, .church, .serve: .study
        case .memory, .ai, .shared: .assistant
        case .notifications, .feedback, .about: .app
        }
    }

    var title: String {
        switch self {
        case .account: "Account"
        case .appearance: "Appearance & reading"
        case .language: "Language"
        case .highlights: "Highlight labels"
        case .church: "My church"
        case .serve: "Ways to Serve"
        case .memory: "Memory"
        case .ai: "AI"
        case .shared: "Shared answers"
        case .notifications: "Notifications"
        case .feedback: "Send feedback"
        case .about: "About"
        }
    }

    /// The line under the page title, saying what the page is for.
    var summary: String {
        switch self {
        case .account: "Who is signed in, signing out, and deleting your account."
        case .appearance: "Theme, the parchment page, and your default Bible translation."
        case .language: "The language SureWord answers in, and its Bible."
        case .highlights: "Names and meanings for your highlight colours."
        case .church: "The congregation you belong to."
        case .serve: "Optional ways to put faith into action, online, nearby or both."
        case .memory: "What SureWord remembers about you, and what you've told it."
        case .ai: "SureWord Pro, web search and data sharing."
        case .shared: "Public links to answers and verse cards you've sent."
        case .notifications: "The daily verse reminder and answer-ready notices."
        case .feedback: "Tell us what is broken or missing."
        case .about: "Version, release notes and links."
        }
    }

    var symbol: String {
        switch self {
        case .account: "person.crop.circle"
        case .appearance: "paintpalette.fill"
        case .language: "globe"
        case .highlights: "highlighter"
        case .church: "building.columns.fill"
        case .serve: "hands.sparkles.fill"
        case .memory: "sparkles"
        case .ai: "cpu.fill"
        case .shared: "square.and.arrow.up.fill"
        case .notifications: "bell.badge.fill"
        case .feedback: "bubble.left.and.text.bubble.right.fill"
        case .about: "info.circle.fill"
        }
    }

    /// System Settings-style tile colours, so a page is found by colour as
    /// much as by name.
    var tint: Color {
        switch self {
        case .account: .gray
        case .appearance: .indigo
        case .language: .cyan
        case .highlights: .orange
        case .church: .brown
        case .serve: .pink
        case .memory: .purple
        case .ai: .teal
        case .shared: .blue
        case .notifications: .red
        case .feedback: .green
        case .about: .gray
        }
    }

    /// Words a reader might search for that are on the page but not in its title.
    private var keywords: [String] {
        switch self {
        case .account: ["sign out", "log out", "delete", "email", "profile"]
        case .appearance: ["theme", "dark", "light", "parchment", "translation", "kjv", "nkjv", "bsb", "bible", "quiz"]
        case .language: ["spanish", "german", "espa\u{00F1}ol", "espanol", "deutsch", "reina-valera", "luther", "answers"]
        case .highlights: ["colour", "color", "highlight", "labels", "yellow", "meaning"]
        case .church: ["church", "congregation", "mission"]
        case .serve: ["serve", "volunteer", "give", "giving", "food bank", "journal", "nearby"]
        case .memory: ["memories", "about me", "testimony", "personal", "remember"]
        case .ai: ["model", "pro", "membership", "subscription", "web search", "tavily", "consent", "privacy"]
        case .shared: ["links", "share", "cards", "revoke", "privacy"]
        case .notifications: ["verse of the day", "reminder", "daily", "chat", "alert"]
        case .feedback: ["bug", "report", "suggestion", "contact"]
        case .about: ["version", "what's new", "release notes", "privacy policy", "terms", "website"]
        }
    }

    func matches(_ query: String) -> Bool {
        let query = query.trimmingCharacters(in: .whitespaces).lowercased()
        if query.isEmpty { return true }
        return title.lowercased().contains(query)
            || summary.lowercased().contains(query)
            || keywords.contains { $0.contains(query) }
    }
}

/// A rounded, filled square holding the page's symbol, as in System Settings.
struct SettingsIconTile: View {
    let pane: SettingsPane
    var size: CGFloat = 22

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
            .fill(pane.tint.gradient)
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: pane.symbol)
                    .appFont(.system(size: size * 0.5, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .accessibilityHidden(true)
    }
}

private struct SettingsSidebarRow: View {
    let pane: SettingsPane

    var body: some View {
        Label {
            Text(pane.title)
                .appFont(.system(size: 13))
        } icon: {
            SettingsIconTile(pane: pane)
        }
        .padding(.vertical, 2)
        .accessibilityIdentifier("settings.pane.\(pane.rawValue)")
    }
}
