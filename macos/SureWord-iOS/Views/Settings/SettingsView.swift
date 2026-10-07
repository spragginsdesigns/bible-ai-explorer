import ClerkKit
import SwiftUI

/// Settings hub - the iOS form of Android 1.69.0's nested Settings
/// (`mobile/app/(app)/settings/index.tsx`): a profile row, then STUDY,
/// ASSISTANT and APP groups with one row per category, each pushing its own
/// page (`SettingsPages.swift`). Same categories in the same order; Android's
/// "Check for updates" row is a Play Store feature and has no iOS counterpart.
///
/// The rows show the current value so the common question ("is memory on?")
/// is answered here rather than a tap away. Their subtitles read the
/// persisted per-account `SettingsDataStore` (PRD B7), so they are final on
/// the first frame and revalidate in place every time the hub appears.
///
/// Pushed from the tab toolbar gear, so it sits inside the tab's
/// NavigationStack and needs no Done button of its own.
struct SettingsView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Environment(Clerk.self) private var clerk

    /// Every return from a category page reappears the hub, and the store only
    /// dedupes requests already in flight, so without a floor a walk through
    /// four categories would refetch providers, church and memories five times
    /// over. The pages that change those values write the store directly.
    static let prefetchMinInterval: TimeInterval = 15
    @MainActor private static var lastPrefetchAt: Date?

    private var data: SettingsDataStore { .shared }

    var body: some View {
        List {
            Section {
                NavigationLink {
                    AccountSettingsPage()
                } label: {
                    HStack(spacing: Spacing.md) {
                        avatar
                        VStack(alignment: .leading, spacing: 2) {
                            Text(SettingsProfile.name(clerk.user) ?? "Signed in")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(theme.text)
                            if let email = SettingsProfile.email(clerk.user) {
                                Text(email)
                                    .font(.footnote)
                                    .foregroundStyle(theme.textFaint)
                            }
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                }
            }

            Section("Study") {
                row("Appearance & reading", symbol: "paintpalette", subtitle: appearanceSubtitle) {
                    AppearanceSettingsPage()
                }
                row("Highlight labels", symbol: "paintbrush", subtitle: "Names and meanings for your colours") {
                    HighlightLabelsPage()
                }
                // The whole row disappears when the server has no Places key,
                // matching the section it opens: there is nothing behind it.
                if data.church.data != .unavailable {
                    row("My church", symbol: "building.columns", subtitle: churchSubtitle) {
                        ChurchSettingsPage()
                    }
                }
            }

            Section("Assistant") {
                row("Memory", symbol: "sparkles", subtitle: memorySubtitle) {
                    MemorySettingsPage()
                }
                row("AI", symbol: "cpu", subtitle: aiSubtitle) {
                    AISettingsPage()
                }
                row("Shared answers", symbol: "square.and.arrow.up", subtitle: "Links you have shared") {
                    SharedAnswersSettingsPage()
                }
            }

            Section("App") {
                row("Notifications", symbol: "bell", subtitle: notificationsSubtitle) {
                    NotificationSettingsPage()
                }
                row(
                    "Send feedback",
                    symbol: "bubble.left.and.text.bubble.right",
                    subtitle: "Tell us what is broken or missing"
                ) {
                    FeedbackView(api: app.api)
                        .analyticsScreen(AnalyticsScreen.feedback)
                }
                row("About", symbol: "info.circle", subtitle: "Version \(Config.appVersion)") {
                    AboutSettingsPage()
                }
            }
        }
        .navigationTitle("Settings")
        .analyticsScreen(AnalyticsScreen.settings)
        .onAppear(perform: revalidate)
    }

    // MARK: - Revalidation

    /// Opening Settings is also the retry for a preferences hydrate that
    /// failed at launch (throttled inside the sync model), and the moment the
    /// row subtitles are refreshed.
    private func revalidate() {
        app.preferences.refresh()
        let now = Date()
        if let last = Self.lastPrefetchAt, now.timeIntervalSince(last) < Self.prefetchMinInterval { return }
        Self.lastPrefetchAt = now
        let api = app.api
        Task { await SettingsDataStore.shared.prefetch(.live(api)) }
    }

    // MARK: - Subtitles

    private var appearanceSubtitle: String {
        SettingsHubSubtitles.appearance(
            theme: app.settings.appearance,
            parchment: app.settings.parchment,
            translation: app.settings.translation
        )
    }

    private var churchSubtitle: String {
        SettingsHubSubtitles.church(data.church.data)
    }

    private var memorySubtitle: String {
        SettingsHubSubtitles.memory(
            enabled: app.preferences.memoryEnabled ?? data.memories.data?.enabled,
            count: data.memories.data?.count
        )
    }

    private var aiSubtitle: String {
        SettingsHubSubtitles.ai(connectedKeys: data.providers.data?.providers.filter(\.connected).count ?? 0)
    }

    private var notificationsSubtitle: String {
        SettingsHubSubtitles.notifications(
            enabled: app.settings.verseOfDayEnabled,
            hour: app.settings.verseOfDayHour
        )
    }

    // MARK: - Rows

    private var avatar: some View {
        Text(SettingsProfile.initial(clerk.user))
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(theme.accent)
            .frame(width: 44, height: 44)
            .background(theme.accentSoft, in: .circle)
            .overlay { Circle().strokeBorder(theme.accentBorder, lineWidth: 1) }
            .accessibilityHidden(true)
    }

    private func row<Destination: View>(
        _ title: String,
        symbol: String,
        subtitle: String,
        @ViewBuilder destination: @escaping () -> Destination
    ) -> some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: symbol)
                    .font(.body)
                    .foregroundStyle(theme.accent)
                    .frame(width: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .foregroundStyle(theme.text)
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(theme.textFaint)
                        .lineLimit(2)
                }
            }
            .padding(.vertical, 2)
        }
        .accessibilityIdentifier("settings.row.\(title)")
    }
}

/// The hub's row subtitles, word for word Android's (`settings/index.tsx`), as
/// pure functions so the copy is pinned by `SettingsHubTests`.
@MainActor
enum SettingsHubSubtitles {
    static func appearance(theme: AppearanceSetting, parchment: Bool, translation: TranslationID) -> String {
        [theme.label, parchment ? "Parchment" : "Plain reader", translation.rawValue].joined(separator: " · ")
    }

    /// Unknown → an ellipsis rather than a guess; a saved church by name.
    static func church(_ response: ChurchResponse?) -> String {
        switch response {
        case nil: "…"
        case .ok(let church?): church.name
        case .ok(nil), .unavailable: "Not set"
        }
    }

    static func memory(enabled: Bool?, count: Int?) -> String {
        guard let enabled else { return "…" }
        guard enabled else { return "Off" }
        guard let count else { return "On" }
        return "On · \(count) saved"
    }

    static func ai(connectedKeys: Int) -> String {
        let base = "Membership, provider keys, web search"
        guard connectedKeys > 0 else { return base }
        return "\(base) · \(connectedKeys) \(connectedKeys == 1 ? "key" : "keys")"
    }

    static func notifications(enabled: Bool, hour: Int) -> String {
        enabled ? "Daily verse \(SettingsStore.formatHour(hour))" : "Daily verse off"
    }
}

/// The signed-in person as the hub and the Account page show them.
@MainActor
enum SettingsProfile {
    /// Android shows the Clerk full name and falls back to the username
    /// (`user?.fullName ?? user?.username`). ClerkKit keeps `fullName`
    /// internal, so it is composed from the two public parts here.
    static func name(_ user: User?) -> String? {
        let parts = [user?.firstName, user?.lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        let name = parts.joined(separator: " ")
        if !name.isEmpty { return name }
        let username = user?.username?.trimmingCharacters(in: .whitespaces)
        if let username, !username.isEmpty { return username }
        return nil
    }

    static func email(_ user: User?) -> String? {
        user?.primaryEmailAddress?.emailAddress
    }

    /// Android's avatar: the first letter of the name, else the email, else ✝.
    static func initial(_ user: User?) -> String {
        // U+FE0E asks for the text glyph; without it iOS draws the cross as
        // a purple emoji tile.
        let cross = "\u{271D}\u{FE0E}"
        let source = (name(user) ?? email(user) ?? "").trimmingCharacters(in: .whitespaces)
        return source.first.map { String($0).uppercased() } ?? cross
    }
}
