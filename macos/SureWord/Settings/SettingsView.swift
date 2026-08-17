import ClerkKit
import SwiftUI

/// Settings pane — the Mac form of `mobile/app/(app)/settings.tsx`, section for
/// section: Appearance, Bible translation, Memory (enable + manage), Account and
/// About.
struct SettingsView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(Clerk.self) private var clerk

    @State private var isConfirmingSignOut = false
    @State private var isMemoriesPresented = false
    /// Owned here rather than in the sheet so the saved count stays truthful
    /// after the sheet adds or deletes something.
    @State private var memory = MemoriesModel()

    var body: some View {
        @Bindable var settings = app.settings

        VStack(spacing: 0) {
            Form {
                Section("Appearance") {
                    Picker("Theme", selection: $settings.appearance) {
                        ForEach(AppearanceSetting.allCases, id: \.self) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    hint("System follows your Mac's dark or light mode.")
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
                            + "SureWord's AI answers always quote the KJV."
                    )
                }

                verseOfDaySection

                memorySection

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
            .formStyle(.grouped)

            Divider().overlay(theme.border)

            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(Spacing.md)
        }
        .frame(width: 480, height: 560)
        .task {
            memory.configure(app.api)
            await memory.load()
        }
        .sheet(isPresented: $isMemoriesPresented) {
            MemoriesView(model: memory)
        }
        .memoryErrorAlert(memory, isActive: !isMemoriesPresented)
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
                            .font(.system(size: 12, weight: .semibold))
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
                    set: { enabled in Task { await memory.setEnabled(enabled) } }
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
