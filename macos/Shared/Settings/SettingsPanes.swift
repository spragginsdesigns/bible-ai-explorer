import SwiftUI

// The Mac Settings window's pages. Shared, not macOS-only, so the request
// mapping and the analytics routes below are pinned by the iOS test target
// (`SettingsPageRequestTests`); iOS never draws them.

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
        case .about: "Version, updates, release notes and links."
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
        case .about: ["version", "update", "download", "what's new", "release notes", "privacy policy", "terms", "website"]
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

extension SettingsPane {
    /// Where `AppModel.openSettings(_:)` lands on the Mac. Membership has no
    /// page of its own here: it is the first section of the AI page, as on
    /// Android (`settings/ai.tsx`).
    init(request: SettingsPageRequest) {
        switch request {
        case .account: self = .account
        case .ai, .membership: self = .ai
        case .memory: self = .memory
        case .church: self = .church
        case .notifications: self = .notifications
        }
    }

    /// The route `screen_viewed` reports for this page: Android's route for
    /// the same category under `mobile/app/(app)/settings/`, so a Mac on the
    /// AI page and a phone on it are one row in a chart.
    var analyticsScreen: String {
        switch self {
        case .account: AnalyticsScreen.settingsAccount
        case .appearance: AnalyticsScreen.settingsAppearance
        case .language: AnalyticsScreen.settingsLanguage
        case .highlights: AnalyticsScreen.settingsHighlights
        case .church: AnalyticsScreen.settingsChurch
        case .serve: AnalyticsScreen.settingsServe
        case .memory: AnalyticsScreen.settingsMemory
        case .ai: AnalyticsScreen.settingsAI
        case .shared: AnalyticsScreen.settingsShared
        case .notifications: AnalyticsScreen.settingsNotifications
        case .feedback: AnalyticsScreen.feedback
        case .about: AnalyticsScreen.settingsAbout
        }
    }
}
