import SwiftUI

struct TodayTabView: View {
    @Environment(AppModel.self) private var app
    @State private var path: [DailyWalkDestination] = []
    var body: some View {
        NavigationStack(path: $path) {
            DailyWalkHome(
                onCross: { NotificationCenter.default.post(name: .openDailyCross, object: nil) },
                onPlan: { path.append(.plan) },
                onLearn: { path.append(.learn) },
                onHistory: { path.append(.history) }
            )
            .spotlightTarget(.tabToday)
            .spotlightHost()
            .settingsGearToolbar(help: .today)
            .navigationDestination(for: DailyWalkDestination.self) { destination in
                switch destination {
                case .plan: ReadingPlanView().analyticsScreen(AnalyticsScreen.plan)
                case .learn: LearnView().analyticsScreen(AnalyticsScreen.learn)
                case .history:
                    ReadingHistoryView(model: app.bible.reading, onOpen: { target in
                        app.pendingVerseReference = ConnectionsPlace(order: target.book, chapter: target.chapter, verse: target.verse).reference
                        app.pendingVerseTranslation = target.translation
                        app.section = .bible
                    }, onTalk: { prompt in
                        if let prompt { app.chat.input = prompt }
                        app.section = .chat
                    }).analyticsScreen(AnalyticsScreen.history)
                }
            }
        }
        .onChange(of: app.pendingDailyDestination, initial: true) { _, pending in
            if let pending { path = [pending]; app.pendingDailyDestination = nil }
        }
        // Walk with me lights a Today card: back to the root first.
        .onChange(of: app.onboarding.pendingRootReset.contains(.today), initial: true) { _, pending in
            if pending, app.onboarding.consumeRootReset(.today) { path = [] }
        }
    }
}

private enum StudyDestination: Hashable { case notes, atlas, sermons, words }

struct StudyTabView: View {
    @Environment(AppModel.self) private var app
    @State private var path: [StudyDestination] = []
    var body: some View {
        NavigationStack(path: $path) {
            StudyHome(onNotes: { path.append(.notes) }, onAtlas: { path.append(.atlas) },
                      onSermons: { path.append(.sermons) }, onWords: { path.append(.words) })
                .spotlightTarget(.tabStudy)
                .spotlightHost()
                .settingsGearToolbar(help: .study)
                .navigationDestination(for: StudyDestination.self) { destination in
                    switch destination {
                    case .notes: NotesTabView().analyticsScreen(AnalyticsScreen.notes)
                    case .atlas: AtlasExplorerView(model: app.atlas).analyticsScreen(AnalyticsScreen.timeline)
                    case .sermons: SermonStudiesView().analyticsScreen(AnalyticsScreen.sermons)
                    case .words: OriginalLanguagesHome()
                    }
                }
        }
        .onChange(of: app.pendingNoteID, initial: true) { _, note in
            guard note != nil else { return }
            // A receipt always opens Notes inside Study, even when another
            // Study tool is currently pushed.
            path = [.notes]
        }
        // Walk with me lights a Study row: back to the root first.
        .onChange(of: app.onboarding.pendingRootReset.contains(.study), initial: true) { _, pending in
            if pending, app.onboarding.consumeRootReset(.study) { path = [] }
        }
    }
}
