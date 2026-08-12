import ClerkKit
import SwiftUI

/// Settings pane. Appearance and translation are live now because both affect
/// chat; memory controls arrive with the memories phase.
struct SettingsView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(Clerk.self) private var clerk

    @State private var isConfirmingSignOut = false

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
                }

                Section("Bible") {
                    Picker("Default translation", selection: $settings.translation) {
                        ForEach(TranslationID.allCases, id: \.self) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    Text(settings.translation.copyright)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textGhost)
                }

                Section("Account") {
                    if let email = clerk.user?.primaryEmailAddress?.emailAddress {
                        LabeledContent("Signed in as", value: email)
                    }
                    Button("Sign out", role: .destructive) { isConfirmingSignOut = true }
                }

                Section("About") {
                    LabeledContent("Version", value: Config.appVersion)
                    Text(
                        "SureWord answers from the King James Bible, received as the "
                            + "inerrant, infallible Word of God."
                    )
                    .font(.system(size: 11))
                    .foregroundStyle(theme.textGhost)
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
        .frame(width: 480, height: 520)
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
        }
    }
}
