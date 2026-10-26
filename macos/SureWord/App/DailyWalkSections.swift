import SwiftUI

struct TodaySection: View {
    @Environment(AppModel.self) private var app
    @SceneStorage("sureword.today.destination") private var destinationRaw = ""
    private var destination: DailyWalkDestination? {
        get { DailyWalkDestination(rawValue: destinationRaw) }
        nonmutating set { destinationRaw = newValue?.rawValue ?? "" }
    }
    var body: some View {
        Group {
            switch destination {
            case .plan:
                ReadingPlanPane(model: app.bible.plan, onOpenReading: { reading in
                    app.pendingVerseReference = "\(reading.book) \(reading.chapter)"
                    app.section = .bible
                }, onDismiss: { destination = nil })
            case .learn: LearnPane(onDismiss: { destination = nil })
            case .history:
                ReadingHistoryView(model: app.bible.reading, onOpen: { target in
                    app.pendingVerseReference = ConnectionsPlace(order: target.book, chapter: target.chapter, verse: target.verse).reference
                    app.pendingVerseTranslation = target.translation
                    app.section = .bible
                }, onTalk: { prompt in
                    if let prompt { app.chat.input = prompt }
                    app.section = .chat
                }, onClose: { destination = nil })
                .toolbar { Button("Back to Today", systemImage: "chevron.left") { destination = nil } }
            case nil:
                DailyWalkHome(onCross: { app.section = .cross }, onPlan: { destination = .plan },
                              onLearn: { destination = .learn }, onHistory: { destination = .history })
            }
        }
        .onChange(of: app.pendingDailyDestination, initial: true) { _, pending in
            if let pending { destination = pending; app.pendingDailyDestination = nil }
        }
        // Walk with me lights a Today card: back to the home first.
        .onChange(of: app.onboarding.pendingRootReset.contains(.today), initial: true) { _, pending in
            if pending, app.onboarding.consumeRootReset(.today) { destination = nil }
        }
    }
}

enum MacStudyDestination: String { case atlas, sermons, words }

struct StudySection: View {
    @Environment(AppModel.self) private var app
    @SceneStorage("sureword.study.destination") private var destinationRaw = ""
    private var destination: MacStudyDestination? {
        get { MacStudyDestination(rawValue: destinationRaw) }
        nonmutating set { destinationRaw = newValue?.rawValue ?? "" }
    }
    var body: some View {
        Group {
            switch destination {
            case .atlas:
                AtlasExplorerPane(model: app.atlas, onOpenReference: { reference in
                    app.pendingVerseReference = reference
                    app.section = .bible
                }, onDismiss: { destination = nil })
            case .sermons: SermonStudiesPane(onDismiss: { destination = nil })
            case .words:
                OriginalLanguagesHome()
                    .toolbar { Button("Back to Study", systemImage: "chevron.left") { destination = nil } }
            case nil:
                StudyHome(onNotes: { app.section = .notes }, onAtlas: { destination = .atlas },
                          onSermons: { destination = .sermons }, onWords: { destination = .words })
            }
        }
        // Walk with me lights a Study row: back to the home first.
        .onChange(of: app.onboarding.pendingRootReset.contains(.study), initial: true) { _, pending in
            if pending, app.onboarding.consumeRootReset(.study) { destination = nil }
        }
    }
}
