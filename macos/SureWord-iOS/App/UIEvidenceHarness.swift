import SwiftUI

/// Debug-only screenshot harness for simulator evidence runs
/// (`docs/ios/evidence/`). Launched with `-SureWordEvidence YES`, the app skips
/// sign-in and shows one real screen - the shipping views over a session-less
/// `AppModel` - in a state chosen by launch arguments, so `simctl io
/// screenshot` can capture it without driving taps:
///
///     -evidence.screen home|reader|search|feedback|readingLog|atlas|picker|cross|memories|notes
///     -evidence.book 43 -evidence.chapter 3 -evidence.translation BSB
///     -evidence.select 16 -evidence.selectEnd 18 -evidence.scrollVerse 9
///     -evidence.tier peek|expanded -evidence.tab explain|words|seeAlso
///     -evidence.parchment 1 -evidence.appearance dark|light
///     -evidence.query "living water"
///     -evidence.lastRead "Judges|7|BSB"
///     -evidence.screen shell   (the signed-in tab shell, so a share waiting
///                               in the App Group inbox opens as a chat)
///     -evidence.screen settings | settings-<page>   (the Settings hub, or one
///         of its pages: account, appearance, highlights, church, memory, ai,
///         shared, notifications, feedback, about). The hub's per-account
///         cache is seeded with a sample church, key and memory count, so the
///         rows and pages show the cached, offline-first state (PRD B7).
///
/// With fixtures installed (`EvidenceFixtures`, written into the app's
/// Documents by `scripts/app-store-screenshots.py`) the account routes those
/// fixtures name answer from disk, so the same screens draw signed-in content:
///     -evidence.screen shell -evidence.conversation <id> -evidence.shellTab notes
///
/// Without fixtures nothing authenticated works here (no Clerk session): offline text, search,
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
                // `-evidence.shellTab bible|notes` picks the first tab and
                // `-evidence.conversation <id>` opens a fixture conversation
                // (`EvidenceFixtures`), as tapping it in History would.
                TabShell().environment(app)
                    .task {
                        guard let id = Self.string("conversation") else { return }
                        await app.chat.loadConversations()
                        await app.chat.switchConversation(to: id)
                    }
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
        case "settings":
            SettingsView()
        case "settings-account":
            AccountSettingsPage()
        case "settings-appearance":
            AppearanceSettingsPage()
        case "settings-highlights":
            HighlightLabelsPage()
        case "settings-church":
            ChurchSettingsPage()
        case "settings-memory":
            MemorySettingsPage()
        case "settings-ai":
            AISettingsPage()
        case "settings-shared":
            SharedAnswersSettingsPage()
        case "settings-notifications":
            NotificationSettingsPage()
        case "settings-feedback":
            if let app { FeedbackView(api: app.api) }
        case "settings-about":
            AboutSettingsPage()
        // PRD verify lane (docs/ios/evidence/verify/): the screens as a
        // signed-out session draws them; their account routes answer 401.
        case "readingLog":
            if let app { ReadingHistoryView(model: app.bible.reading, onOpen: { _ in }, onTalk: { _ in }) }
        case "atlas":
            if let app { AtlasExplorerView(model: app.atlas, book: Self.int("book"), chapter: Self.int("chapter")) }
        case "picker":
            if let app { ModelPickerSheet(api: app.api, settings: app.settings) }
        case "cross":
            CrossView(onOpenReader: {}, onOpenChat: {})
        case "memories":
            if let app { EvidenceMemoriesScreen(api: app.api) }
        case "notes":
            NotesTabView()
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
        if Self.string("screen")?.hasPrefix("settings") == true { Self.seedSettingsData() }
    }

    /// Sample per-account Settings data, written the way a real session's
    /// prefetch would have left it.
    private static func seedSettingsData() {
        let store = SettingsDataStore.shared
        store.noteChurch(.ok(church: ChurchProfile(
            placeId: "evidence",
            name: "Grace Bible Church",
            address: "1200 Olive Ave, Fresno, CA",
            phone: nil,
            website: nil,
            mapsUrl: nil,
            photoUrl: nil,
            mission: "To know Christ and to make Him known.",
            about: nil,
            missionSource: nil,
            updatedAt: "2026-10-07T08:00:00.000Z"
        )))
        store.noteProviders(AIProvidersResponse(
            serverCredentials: false,
            providers: [
                AIProviderStatus(id: "openai", label: "OpenAI", keyURL: nil, connected: true, last4: "9f2c", validatedAt: nil),
                AIProviderStatus(id: "anthropic", label: "Anthropic", keyURL: nil, connected: false, last4: nil, validatedAt: nil),
            ]
        ))
        store.noteMemoryCount(12)
        store.noteMemoryEnabled(true)
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
                // Bring the selection into view the way a deep link does.
                // `-evidence.scrollVerse N` scrolls to another verse first, so
                // a selection low on screen proves the reader lifts it clear
                // of the sheet (`ReaderReveal`).
                model.pendingVerse = Self.int("scrollVerse") ?? first
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

    /// The tab the shell opens on: Chat everywhere except an evidence run
    /// that asked for another one.
    static var initialShellTab: AppSection {
        #if DEBUG
        if isEnabled, let raw = UserDefaults.standard.string(forKey: "evidence.shellTab"),
           let tab = AppSection(rawValue: raw) {
            return tab
        }
        #endif
        return .chat
    }
}

#if DEBUG
/// Settings -> Memory over the fixture `/api/memories` answer.
private struct EvidenceMemoriesScreen: View {
    let api: APIClient
    @State private var model = MemoriesModel()

    var body: some View {
        MemoriesView(model: model)
            .task {
                model.configure(api)
                await model.load()
                // `-evidence.summary 1` presses "Generate summary", as a tap would.
                if UserDefaults.standard.string(forKey: "evidence.summary") == "1" {
                    await model.generateSummary()
                }
            }
    }
}
#endif
