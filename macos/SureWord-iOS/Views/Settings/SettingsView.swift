import ClerkKit
import SwiftUI

/// Settings screen — the iOS form of `macos/SureWord/Settings/SettingsView.swift`
/// (itself a port of `mobile/app/(app)/settings.tsx`), section for section:
/// Appearance, Bible translation, Verse of the Day, Memory, Account and About.
/// Pushed from the tab toolbar gear, so it sits inside the tab's
/// NavigationStack and needs no Done button of its own.
struct SettingsView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Environment(Clerk.self) private var clerk

    @State private var isConfirmingSignOut = false
    /// True while the pushed Memories route is frontmost, so only one of the
    /// two views observing the same model owns the error alert at a time (the
    /// Mac uses the sheet's presentation flag for this).
    @State private var isMemoriesFrontmost = false
    /// Owned here rather than in the pushed view so the saved count stays
    /// truthful after the route adds or deletes something.
    @State private var memory = MemoriesModel()
    /// Owned here for the same reason as `memory`: the section is drawn inline,
    /// but the model must outlive a redraw so a save or removal is not re-run.
    @State private var church = ChurchModel()

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
                hint("System follows your iPhone's dark or light mode.")
            }

            Section("Bible") {
                Picker("Default translation", selection: $settings.translation) {
                    ForEach(TranslationID.allCases, id: \.self) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                hint(
                    "Used by the Bible reader and verse attachments. \(settings.translation.copyright). "
                        + "SureWord's AI answers use the translation you select."
                )
            }

            verseOfDaySection

            memorySection

            WebSearchSection(preferences: app.preferences)

            churchSection

            ProviderSettingsSection()

            Section("Account") {
                if let name = accountName {
                    LabeledContent("Signed in as", value: name)
                    if let email = clerk.user?.primaryEmailAddress?.emailAddress, email != name {
                        LabeledContent("Email", value: email)
                    }
                } else if let email = clerk.user?.primaryEmailAddress?.emailAddress {
                    LabeledContent("Signed in as", value: email)
                }
                Button("Sign out", role: .destructive) { isConfirmingSignOut = true }
            }

            Section("About") {
                LabeledContent("Version", value: Config.appVersion)
                hint("A Bible study assistant rooted in the King James Version.")
                hint(
                    "Why it's different: ask a generic AI if the Bible is really the Word of God "
                        + "and you'll hear \u{201C}it depends on your viewpoint.\u{201D} SureWord never "
                        + "hedges — it answers as a Bible-believing Christian, standing on Scripture "
                        + "as the inerrant, infallible, final authority for every answer. "
                        + "\u{201C}All scripture is given by inspiration of God\u{201D} — 2 Timothy 3:16."
                )
            }
        }
        .navigationTitle("Settings")
        .task {
            memory.configure(app.api)
            await memory.load()
        }
        .task {
            church.configure(app.api)
            await church.load()
        }
        .memoryErrorAlert(memory, isActive: !isMemoriesFrontmost)
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

    // MARK: - Verse of the Day

    /// Mirrors Android's "Verse of the Day" card: the reminder toggle and the
    /// hour it arrives. Like the Mac there is no push token to register — the
    /// phone schedules a local daily reminder and pulls the day when opened
    /// (see `DailyCrossNotifications`, which also requests authorization the
    /// moment the toggle turns on, via TabShell's sync task).
    @ViewBuilder
    private var verseOfDaySection: some View {
        @Bindable var settings = app.settings

        Section("Verse of the Day") {
            Toggle("Daily verse notification", isOn: $settings.verseOfDayEnabled)
            hint(
                "An AI-picked verse each morning, shaped by what you've been reading and "
                    + "asking about."
            )

            if settings.verseOfDayEnabled {
                LabeledContent("Arrives at") {
                    Stepper(
                        value: $settings.verseOfDayHour,
                        in: 0...23,
                        step: 1
                    ) {
                        Text(SettingsStore.formatHour(settings.verseOfDayHour))
                            .font(.system(size: 13, weight: .semibold))
                            .monospacedDigit()
                    }
                    .accessibilityLabel("Reminder hour")
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
                    set: { enabled in Task { await memory.setEnabled(enabled) } }
                )
            )
            .disabled(memory.isEnabled == nil || memory.isTogglePending)
            hint("When off, SureWord won't use or save memories. Your saved memories are kept.")

            NavigationLink {
                MemoriesView(model: memory)
                    .onAppear { isMemoriesFrontmost = true }
                    .onDisappear { isMemoriesFrontmost = false }
            } label: {
                LabeledContent(
                    "Manage memories",
                    value: memory.hasLoaded && memory.loadError == nil ? "\(memory.memories.count) saved" : "…"
                )
            }
        }
    }

    // MARK: - My church

    /// Mirrors Android's MY CHURCH card and the web settings section. The view
    /// owns its own `Section` so it can vanish entirely, heading and all, when
    /// the server has no Google Places key configured. Unlike Memories there is
    /// nothing to push: the picker and the saved card fit in the form.
    private var churchSection: some View {
        ChurchSectionView(model: church)
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

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(theme.textGhost)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
