import SwiftUI

/// The route patterns `screen_viewed` reports, named exactly as Android's
/// `useScreenTracking` names them (expo-router segments with the groups
/// dropped), so an iPhone opening the reader and an Android phone opening it
/// are one row in a chart, not two.
///
/// Patterns, never resolved paths: a chapter is `/bible/chapter` and a note is
/// `/notes/[id]`. Which book someone opened or which note they wrote in is
/// study content, and the pattern is what keeps it out.
enum AnalyticsScreen {
    static let chat = "/"
    static let signIn = "/sign-in"
    static let bible = "/bible"
    static let chapter = "/bible/chapter"
    static let chapters = "/bible/chapters"
    static let search = "/bible/search"
    static let atlas = "/bible/atlas/[id]"
    static let learn = "/bible/learn"
    static let plan = "/bible/plan"
    static let sermons = "/bible/sermons"
    static let cross = "/bible/cross"
    static let notes = "/notes"
    static let note = "/notes/[id]"
    static let memories = "/memories"
    static let settings = "/settings"
    static let feedback = "/settings/feedback"

    /// A primary section's route. The Daily Cross is `/bible/cross` on
    /// Android, where it is pushed from the Bible home.
    static func pattern(for section: AppSection) -> String {
        switch section {
        case .chat: chat
        case .bible: bible
        case .notes: notes
        case .cross: cross
        }
    }
}

/// A scene phase in the words Android's `AppState` uses, for lifecycle events
/// and `request_failed.app_state`.
enum AnalyticsScenePhase {
    static func name(_ phase: ScenePhase) -> String {
        switch phase {
        case .active: "active"
        case .background: "background"
        default: "inactive"
        }
    }
}

extension View {
    /// Report `screen_viewed` each time this view comes on screen. A pushed
    /// view popping back reports its parent again, the same as Android's
    /// segments changing back; a repeat of the screen already showing is
    /// dropped inside `Analytics.screen`.
    func analyticsScreen(_ pattern: String) -> some View {
        onAppear { Analytics.shared.screen(pattern) }
    }
}
