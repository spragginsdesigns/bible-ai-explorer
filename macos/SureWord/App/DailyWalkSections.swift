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
            case .learn: LearnPane(backTitle: "Today", onDismiss: { destination = nil })
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
            case .serve:
                WaysToServeView(model: app.serve)
                    .toolbar { Button("Back to Today", systemImage: "chevron.left") { destination = nil } }
            case nil:
                DailyWalkHome(onCross: { app.section = .cross }, onPlan: { destination = .plan },
                              onLearn: { destination = .learn }, onHistory: { destination = .history },
                              onServe: { destination = .serve })
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

/// The page the Mac's Study section shows in place of the hub. Notes is not
/// here: it is its own section on the Mac.
enum MacStudyDestination: String { case timeline, people, places, sermons, words }

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
            case .timeline, .people, .places:
                AtlasExplorerPane(
                    model: app.atlas,
                    onOpenReference: { reference in
                        app.pendingVerseReference = reference
                        app.section = .bible
                    },
                    onDismiss: { destination = nil },
                    initialMode: AtlasExplorerMode(rawValue: destinationRaw) ?? .timeline,
                    backTitle: "Study"
                )
                // A fresh pane per row, so each opens on its own mode.
                .id(destinationRaw)
            case .sermons: SermonStudiesPane(onDismiss: { destination = nil })
            case .words:
                OriginalLanguagesHome()
                    .toolbar { Button("Back to Study", systemImage: "chevron.left") { destination = nil } }
            case nil:
                StudyHome(onOpen: open)
            }
        }
        // What's new "Try it": that page, in place of whatever was showing.
        .onChange(of: app.pendingStudyDestination, initial: true) { _, pending in
            guard let pending else { return }
            app.pendingStudyDestination = nil
            open(pending)
        }
        // Walk with me lights a Study row: back to the home first.
        .onChange(of: app.onboarding.pendingRootReset.contains(.study), initial: true) { _, pending in
            if pending, app.onboarding.consumeRootReset(.study) { destination = nil }
        }
    }

    private func open(_ page: StudyHubDestination) {
        switch page {
        case .notes: app.section = .notes
        case .timeline: destination = .timeline
        case .people: destination = .people
        case .places: destination = .places
        case .sermons: destination = .sermons
        case .words: destination = .words
        }
    }
}
