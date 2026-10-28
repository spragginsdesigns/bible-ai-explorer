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
                onHistory: { path.append(.history) },
                onServe: { path.append(.serve) }
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
                case .serve: WaysToServeView(model: app.serve)
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

struct StudyTabView: View {
    @Environment(AppModel.self) private var app
    @State private var path: [StudyHubDestination] = []
    var body: some View {
        NavigationStack(path: $path) {
            StudyHome(onOpen: { path.append($0) })
                .spotlightTarget(.tabStudy)
                .spotlightHost()
                .settingsGearToolbar(help: .study)
                .navigationDestination(for: StudyHubDestination.self) { destination in
                    switch destination {
                    case .notes: NotesTabView().analyticsScreen(AnalyticsScreen.notes)
                    case .timeline, .people, .places:
                        AtlasExplorerView(model: app.atlas, mode: AtlasExplorerMode(study: destination) ?? .timeline)
                            .analyticsScreen(AnalyticsScreen.timeline)
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
        // What's new "Try it" and Today's notes link: the page on top of the
        // hub, whatever was pushed before, so Back lands on Study.
        .onChange(of: app.pendingStudyDestination, initial: true) { _, pending in
            guard let pending else { return }
            path = [pending]
            app.pendingStudyDestination = nil
        }
        // Walk with me lights a Study row: back to the root first.
        .onChange(of: app.onboarding.pendingRootReset.contains(.study), initial: true) { _, pending in
            if pending, app.onboarding.consumeRootReset(.study) { path = [] }
        }
    }
}
