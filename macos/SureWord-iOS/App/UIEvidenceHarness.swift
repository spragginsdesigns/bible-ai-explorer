import SwiftUI

/// Debug-only screenshot harness for simulator evidence runs
/// (`docs/ios/evidence/`). Launched with `-SureWordEvidence YES`, the app skips
/// sign-in and shows one real screen - the shipping views over a session-less
/// `AppModel` - in a state chosen by launch arguments, so `simctl io
/// screenshot` can capture it without driving taps:
///
///     -evidence.screen home|reader|search|feedback
///     -evidence.book 43 -evidence.chapter 3 -evidence.translation BSB
///     -evidence.select 16 -evidence.selectEnd 18
///     -evidence.tier peek|expanded -evidence.tab explain|words|seeAlso
///     -evidence.parchment 1 -evidence.appearance dark|light
///     -evidence.query "living water"
///     -evidence.lastRead "Judges|7|BSB"
///     -evidence.screen shell   (the signed-in tab shell, so a share waiting
///                               in the App Group inbox opens as a chat)
///
/// Nothing authenticated works here (no Clerk session): offline text, search,
/// and the public routes (See also) are live; AI and account routes show their
/// signed-out failure states. Release builds compile none of it.
struct UIEvidenceHarness: View {
    #if DEBUG
    static var isEnabled: Bool { UserDefaults.standard.bool(forKey: "SureWordEvidence") }
    #else
    static var isEnabled: Bool { false }
    #endif

    @Environment(SettingsStore.self) private var settings

    #if DEBUG
    @State private var app: AppModel?

    private static func string(_ key: String) -> String? { UserDefaults.standard.string(forKey: "evidence.\(key)") }
    private static func int(_ key: String) -> Int? { string(key).flatMap(Int.init) }

    var body: some View {
        Group {
            if let app, Self.string("screen") == "shell" {
                // The real shell owns its own navigation stacks.
                TabShell().environment(app)
            } else if let app {
                NavigationStack { screen }
                    .environment(app)
                    .task { await drive(app) }
            } else {
                ProgressView()
            }
        }
        .onAppear(perform: configure)
    }

    @ViewBuilder
    private var screen: some View {
        switch Self.string("screen") ?? "reader" {
        case "home":
            BibleTabView()
        case "search":
            BibleSearchView()
        case "feedback":
            if let app { FeedbackView(api: app.api) }
        default:
            ChapterReaderView(order: Self.int("book") ?? 43, chapter: Self.int("chapter") ?? 3)
        }
    }

    private func configure() {
        guard app == nil else { return }
        if let raw = Self.string("translation"), let translation = TranslationID(rawValue: raw) {
            settings.translation = translation
        }
        if let parchment = Self.string("parchment") { settings.parchment = parchment == "1" }
        if let raw = Self.string("appearance"), let appearance = AppearanceSetting(rawValue: raw) {
            settings.appearance = appearance
        }
        if let raw = Self.string("lastRead") {
            let parts = raw.split(separator: "|").map(String.init)
            if parts.count == 3 {
                let body = #"{"lastRead":{"book":"\#(parts[0])","chapter":\#(parts[1]),"translation":"\#(parts[2])","readAt":"2026-10-07T08:00:00.000Z"}}"#
                ContinueReadingModel.evidenceResponse = Data(body.utf8)
            }
        }
        app = AppModel(settings: settings, userID: nil)
    }

    /// Put the reader into the requested sheet state once the chapter is on
    /// screen, through the same model calls a tap makes.
    private func drive(_ app: AppModel) async {
        guard let first = Self.int("select") else { return }
        let model = app.bible
        for _ in 0..<100 {
            if let book = model.book, model.loadedKey == model.chapterKey(app.settings.translation), !model.readerVerses.isEmpty {
                let context = VerseSheetContext(
                    order: book.order,
                    bookName: book.name,
                    chapter: model.chapter,
                    plainTexts: model.readerVerses.map(\.plainText),
                    translation: app.settings.translation
                )
                // Bring the selection into view the way a deep link does, so
                // the capture shows the selected verse above the sheet.
                model.pendingVerse = first
                try? await Task.sleep(for: .milliseconds(600))
                model.sheet.tap(first, context: context)
                if let last = Self.int("selectEnd") { model.sheet.tap(last, context: context) }
                if Self.string("tier") == "expanded" {
                    let tab = VerseSheetModel.StudyTab(rawValue: Self.string("tab") ?? "explain") ?? .explain
                    model.sheet.openStudy(tab)
                }
                return
            }
            try? await Task.sleep(for: .milliseconds(100))
        }
    }
    #else
    var body: some View { EmptyView() }
    #endif
}
