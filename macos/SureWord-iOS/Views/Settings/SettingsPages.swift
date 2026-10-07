import ClerkKit
import SwiftUI

// The Settings hub's category pages, one per row of `SettingsView` and one per
// file under Android's `mobile/app/(app)/settings/`. Each page holds exactly
// the sections the single iOS Settings form used to hold for that category;
// moving them here changed where they live, not what they do.

// MARK: - Account (profile row)

/// `settings/account.tsx`: who is signed in, Sign out, Delete account.
struct AccountSettingsPage: View {
    @Environment(AppModel.self) private var app
    @Environment(Clerk.self) private var clerk

    @State private var isConfirmingSignOut = false

    var body: some View {
        Form {
            Section {
                if let name = SettingsProfile.name(clerk.user) {
                    LabeledContent("Signed in as", value: name)
                    if let email = SettingsProfile.email(clerk.user), email != name {
                        LabeledContent("Email", value: email)
                    }
                } else if let email = SettingsProfile.email(clerk.user) {
                    LabeledContent("Signed in as", value: email)
                }
            }
            Section {
                Button("Sign out", role: .destructive) { isConfirmingSignOut = true }
            }
            Section {
                DeleteAccountRow(app: app)
            }
        }
        .navigationTitle("Account")
        .analyticsScreen(AnalyticsScreen.settingsAccount)
        .confirmationDialog(
            "Sign out of SureWord?",
            isPresented: $isConfirmingSignOut,
            titleVisibility: .visible
        ) {
            Button("Sign out", role: .destructive) {
                Task { await ClerkAuth.signOut() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You can sign back in at any time.")
        }
    }
}

// MARK: - Appearance & reading

/// `settings/appearance.tsx`: theme, the parchment reader and the default
/// translation.
struct AppearanceSettingsPage: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var settings = app.settings

        Form {
            Section("Appearance") {
                Picker("Theme", selection: $settings.appearance) {
                    ForEach(AppearanceSetting.allCases, id: \.self) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                SettingsHint("System follows your iPhone's dark or light mode.")
                // Android's Appearance & reading page carries this switch; the
                // setting already synced on iOS but had no row of its own.
                Toggle("Parchment reader", isOn: $settings.parchment)
                SettingsHint("Read the Bible on aged scroll paper. Off returns the plain reader.")
            }

            Section("Bible translation") {
                Picker("Default translation", selection: $settings.translation) {
                    ForEach(TranslationID.allCases, id: \.self) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                SettingsHint(
                    "Used by the Bible reader and verse attachments. \(settings.translation.copyright). "
                        + "SureWord's AI answers use the translation you select."
                )
            }
        }
        .navigationTitle("Appearance & reading")
        .analyticsScreen(AnalyticsScreen.settingsAppearance)
    }
}

// MARK: - Highlight labels

struct HighlightLabelsPage: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Form {
            HighlightLabelsSection(settings: app.settings, preferences: app.preferences)
        }
        .navigationTitle("Highlight labels")
        .analyticsScreen(AnalyticsScreen.settingsHighlights)
    }
}

// MARK: - My church

struct ChurchSettingsPage: View {
    @Environment(AppModel.self) private var app

    /// Owned by the page so a save or removal in flight survives a redraw. It
    /// paints the cached church on the first frame (`SettingsDataStore`).
    @State private var church = ChurchModel()

    var body: some View {
        Form {
            ChurchSectionView(model: church)
        }
        .navigationTitle("My church")
        .analyticsScreen(AnalyticsScreen.settingsChurch)
        .task {
            church.configure(app.api)
            await church.load()
        }
    }
}

// MARK: - Memory (+ About me, My testimony)

/// `settings/memory.tsx`: the memory switch, the manage screen, and the two
/// private boxes the assistant reads - About me and My testimony.
struct MemorySettingsPage: View {
    @Environment(AppModel.self) private var app

    /// Owned here rather than in the pushed manage view so the saved count
    /// stays truthful after the route adds or deletes something.
    @State private var memory = MemoriesModel()
    /// True while the pushed Memories route is frontmost, so only one of the
    /// two views observing the same model owns the error alert at a time.
    @State private var isMemoriesFrontmost = false

    var body: some View {
        Form {
            Section {
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
                SettingsHint("When off, SureWord won't use or save memories. Your saved memories are kept.")

                NavigationLink {
                    MemoriesView(model: memory)
                        .analyticsScreen(AnalyticsScreen.memories)
                        .onAppear { isMemoriesFrontmost = true }
                        .onDisappear { isMemoriesFrontmost = false }
                } label: {
                    LabeledContent("Manage memories", value: savedLabel)
                }
            } header: {
                Text("Memory")
            }

            AboutMeSection(settings: app.settings, preferences: app.preferences)

            TestimonySection(settings: app.settings, preferences: app.preferences)
        }
        .navigationTitle("Memory")
        .analyticsScreen(AnalyticsScreen.settingsMemory)
        .task {
            memory.configure(app.api)
            await memory.load()
        }
        .onChange(of: app.preferences.memoryEnabled) { _, enabled in
            // A hydrate on foreground can bring back a Memory change made on
            // another client while this page is already open.
            if let enabled { memory.applyRemote(enabled: enabled) }
        }
        .memoryErrorAlert(memory, isActive: !isMemoriesFrontmost)
    }

    /// The live list once loaded; until then the cached count, so the row is
    /// final on the first frame.
    private var savedLabel: String {
        if memory.hasLoaded, memory.loadError == nil { return "\(memory.memories.count) saved" }
        if let count = SettingsDataStore.shared.memories.data?.count { return "\(count) saved" }
        return "…"
    }
}

// MARK: - AI

/// `settings/ai.tsx`: membership (including the StoreKit SureWord Pro
/// screen), bring-your-own provider keys and web search.
struct AISettingsPage: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Form {
            MembershipSection(api: app.api)
            ProviderSettingsSection()
            WebSearchSection(preferences: app.preferences)
        }
        .navigationTitle("AI")
        .analyticsScreen(AnalyticsScreen.settingsAI)
    }
}

// MARK: - Shared answers

struct SharedAnswersSettingsPage: View {
    @Environment(AppModel.self) private var app

    /// A revoke in flight must survive a redraw, or the optimistic row would
    /// snap back while its DELETE is still going.
    @State private var shares = SharedAnswersModel()

    var body: some View {
        Form {
            SharedAnswersSectionView(model: shares)
        }
        .navigationTitle("Shared answers")
        .analyticsScreen(AnalyticsScreen.settingsShared)
        .task {
            shares.configure(app.api)
            await shares.load()
        }
    }
}

// MARK: - Notifications

/// `settings/notifications.tsx`: the "answer is ready" push and the morning
/// verse with its hour. Switching either on is an explicit request, so it
/// asks for notification permission right away (PRD B6a) - the only place
/// the dialog may open without a moment from chat or the Daily Cross.
struct NotificationSettingsPage: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var settings = app.settings

        Form {
            Section("Chat") {
                Toggle("Notify when an answer is ready", isOn: $settings.notifyChatReplies)
                SettingsHint(
                    "Leave the app while SureWord is answering and it keeps working. "
                        + "This tells you when the answer has landed."
                )
            }

            Section("Verse of the Day") {
                Toggle("Daily verse notification", isOn: $settings.verseOfDayEnabled)
                SettingsHint(
                    "An AI-picked verse each morning, shaped by what you've been reading and "
                        + "asking about."
                )

                if settings.verseOfDayEnabled {
                    LabeledContent("Arrives at") {
                        Stepper(value: $settings.verseOfDayHour, in: 0...23, step: 1) {
                            Text(SettingsStore.formatHour(settings.verseOfDayHour))
                                .font(.system(size: 13, weight: .semibold))
                                .monospacedDigit()
                        }
                        .accessibilityLabel("Reminder hour")
                    }
                }
            }
        }
        .navigationTitle("Notifications")
        .analyticsScreen(AnalyticsScreen.settingsNotifications)
        .onChange(of: app.settings.notifyChatReplies) { was, now in
            if now, !was { NotificationPermissionMoments.shared.signal(.settingsEnabled) }
        }
        .onChange(of: app.settings.verseOfDayEnabled) { was, now in
            if now, !was { NotificationPermissionMoments.shared.signal(.settingsEnabled) }
        }
    }
}

// MARK: - About

struct AboutSettingsPage: View {
    var body: some View {
        Form {
            Section {
                LabeledContent("Version", value: Config.appVersion)
                AboutLinkRows()
                SettingsHint("A Bible study assistant rooted in the King James Version.")
                SettingsHint(
                    "Why it's different: ask a generic AI if the Bible is really the Word of God "
                        + "and you'll hear \u{201C}it depends on your viewpoint.\u{201D} SureWord never "
                        + "hedges - it answers as a Bible-believing Christian, standing on Scripture "
                        + "as the inerrant, infallible, final authority for every answer. "
                        + "\u{201C}All scripture is given by inspiration of God\u{201D} - 2 Timothy 3:16."
                )
            }
        }
        .navigationTitle("About")
        .analyticsScreen(AnalyticsScreen.settingsAbout)
    }
}

// MARK: - Shared chrome

/// The small grey line under a setting, as the old single form drew it.
struct SettingsHint: View {
    @Environment(\.theme) private var theme
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(theme.textGhost)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
