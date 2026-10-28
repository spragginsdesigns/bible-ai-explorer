import SwiftUI

/// The home is an invitation, never a generation trigger. Only the explicit
/// devotional action enters the existing Daily Cross workflow.
struct DailyWalkHome: View {
    @Environment(AppModel.self) private var app
    @Environment(\.theme) private var theme
    @Environment(\.scenePhase) private var scenePhase
    let onCross: () -> Void
    let onPlan: () -> Void
    let onLearn: () -> Void
    let onHistory: () -> Void
    let onServe: () -> Void
    @State private var reading: ContinueReadingModel?
    @State private var preview: DailyWalkPreview?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                GettingStartedCard()
                Text("YOUR DAILY WALK").appFont(.caption.weight(.semibold)).tracking(3).foregroundStyle(theme.textMuted)
                Text("Begin with the Word.")
                    .appFont(.custom(FontFamily.verse, size: 34)).foregroundStyle(theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                DailyWalkArtwork().frame(height: 160).clipShape(.rect(cornerRadius: Radius.lg)).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Label("Pick Up Your Cross", systemImage: "cross")
                        .appFont(.custom(FontFamily.verse, size: 28)).foregroundStyle(theme.accent)
                    Text(preview?.text ?? "Thy word is a lamp unto my feet, and a light unto my path.")
                        .appFont(.custom(FontFamily.verse, size: 22)).foregroundStyle(theme.textSecondary).lineLimit(3)
                    Text("\((preview?.reference ?? "Psalm 119:105").uppercased()) · KJV").appFont(.caption.weight(.semibold)).tracking(2).foregroundStyle(theme.textMuted)
                    Button(action: onCross) {
                        HStack { Text("Read today's word"); Spacer(); Image(systemName: "arrow.right") }
                            .appFont(.headline).padding(.vertical, 8).frame(minHeight: 42)
                    }
                    .buttonStyle(.borderedProminent).padding(.top, Spacing.sm)
                }
                .spotlightTarget(.todayCross)
                .id(AppTarget.todayCross)
                if let last = reading?.lastRead {
                    DailyWalkRow(symbol: "book", title: "Continue reading", detail: last.label) { open(last) }
                } else {
                    DailyWalkRow(symbol: "book", title: "Open the Bible", detail: "A quiet place to read") { app.section = .bible }
                }
                DailyWalkRow(symbol: "calendar", title: app.bible.plan.plan?.title ?? "Reading plan", detail: Self.planSubtitle(app.bible.plan), action: onPlan)
                    .spotlightTarget(.todayPlan)
                    .id(AppTarget.todayPlan)
                DailyWalkRow(symbol: "square.stack.3d.up", title: "Learn a verse", detail: "Carry Scripture with you", action: onLearn)
                    .spotlightTarget(.todayLearn)
                    .id(AppTarget.todayLearn)
                DailyWalkRow(symbol: "clock.arrow.circlepath", title: "Your walk", detail: "Your reading log and reflections", action: onHistory)
                ServeTodayCard(onOpen: onServe)
                SendWordHomeCard(titleSize: 16, subtitleSize: 13)
                Button { StudyHubNavigation.open(.notes, in: app) } label: {
                    HStack(spacing: Spacing.sm) {
                        Image(systemName: "doc.text")
                        Text("Your notes in Study")
                        Image(systemName: "arrow.right")
                    }
                    .appFont(.subheadline).foregroundStyle(theme.accent)
                    .frame(minHeight: 44).contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .spotlightScroll(to: [.todayCross, .todayPlan, .todayLearn])
        .background { MeshBackground() }
        .navigationTitle("Today")
        .task {
            if reading == nil { reading = ContinueReadingModel(api: app.api) }
            await reading?.refresh()
            app.bible.plan.loadIfNeeded()
            await refreshPreview()
        }
        // Here rather than on the card: an empty card has no view to hang a
        // task on, so it would never load in the first place.
        .task { await app.onboarding.loadProgress() }
        // Same reason: the Ways to Serve card is empty until this loads.
        .task { await app.serve.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await reading?.refresh(); await refreshPreview(); await app.serve.refresh() } }
        }
    }

    /// Android's plan row: "Loading your plan..." until the first answer, a
    /// way back in when it failed, and the plan's own summary otherwise.
    static func planSubtitle(_ plan: ReadingPlanModel) -> String {
        planSubtitle(plan.plan, hasLoaded: plan.hasLoaded, error: plan.error)
    }

    static func planSubtitle(_ plan: ReadingPlan?, hasLoaded: Bool, error: String?) -> String {
        if !hasLoaded { return "Loading your plan..." }
        if error != nil { return "Open your plan to reconnect" }
        return PlanView.planCardSubtitle(plan)
    }

    private func open(_ last: LastRead) {
        app.pendingVerseReference = last.label
        app.pendingVerseTranslation = last.translation
        app.section = .bible
    }

    private func refreshPreview() async {
        struct Response: Decodable { let cross: DailyWalkPreview? }
        let next = try? await app.api.json("/api/verse-of-day/preview", as: Response.self)
        guard !Task.isCancelled else { return }
        preview = next?.cross
    }
}

struct DailyWalkPreview: Decodable, Sendable {
    let reference: String
    let text: String
}

struct DailyWalkRow: View {
    @Environment(\.theme) private var theme
    let symbol: String
    let title: String
    let detail: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.md) {
                Image(systemName: symbol).appFont(.system(size: 23, weight: .light)).foregroundStyle(theme.accent).frame(width: 32)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).appFont(.headline).foregroundStyle(theme.text)
                    Text(detail).appFont(.subheadline).foregroundStyle(theme.textMuted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").foregroundStyle(theme.textMuted)
            }
            .padding(Spacing.md).frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
            .contentShape(.rect(cornerRadius: Radius.lg))
        }.buttonStyle(.plain)
    }
}

private struct DailyWalkArtwork: View {
    private var imageURL: URL? {
        Bundle.main.url(forResource: "daily-walk-dawn", withExtension: "jpg", subdirectory: "DailyWalk")
            ?? Bundle.main.url(forResource: "daily-walk-dawn", withExtension: "jpg")
    }
    var body: some View {
        GeometryReader { proxy in
            #if os(macOS)
            if let imageURL, let image = NSImage(contentsOf: imageURL) {
                Image(nsImage: image).resizable().scaledToFill().frame(width: proxy.size.width, height: proxy.size.height).clipped()
            } else { fallback }
            #else
            if let imageURL, let image = UIImage(contentsOfFile: imageURL.path) {
                Image(uiImage: image).resizable().scaledToFill().frame(width: proxy.size.width, height: proxy.size.height).clipped()
            } else { fallback }
            #endif
        }
    }
    private var fallback: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.15, green: 0.2, blue: 0.17), Color(red: 0.61, green: 0.4, blue: 0.17)], startPoint: .top, endPoint: .bottom)
            Image(systemName: "sun.horizon").appFont(.system(size: 54, weight: .ultraLight)).foregroundStyle(.white.opacity(0.65))
        }
    }
}

/// Whether the reader's church has anything for the Study hub: Android shows
/// YOUR CHURCH only when `GET /api/sermon-studies` returns studies or events,
/// and the announcements row only for events.
struct StudyChurchPresence: Equatable, Sendable {
    var studies = false
    var events = false

    init(studies: Bool = false, events: Bool = false) {
        self.studies = studies
        self.events = events
    }

    init(_ home: SermonHome) {
        self.init(studies: !home.studies.isEmpty, events: !home.events.isEmpty)
    }

    var showsSection: Bool { studies || events }
    var showsAnnouncements: Bool { events }
}

/// Opens a Study hub page from anywhere (What's new "Try it", Today's notes
/// link). The Study root on each shell consumes `pendingStudyDestination`.
@MainActor
enum StudyHubNavigation {
    static func open(_ destination: StudyHubDestination, in app: AppModel) {
        #if os(macOS)
        // Notes is its own section on the Mac, beside Study.
        if destination == .notes {
            app.section = .notes
            return
        }
        #endif
        app.pendingStudyDestination = destination
        app.section = .study
    }
}

/// Android's `study/index.tsx`: Notes, then the three ways into the atlas and
/// the word studies, then the church's sermons and announcements when it has
/// any. A hidden sermons row leaves the `study.sermons` spotlight unregistered,
/// which the spotlight skips, as Android's does.
struct StudyHome: View {
    @Environment(AppModel.self) private var app
    @Environment(\.theme) private var theme
    let onOpen: (StudyHubDestination) -> Void
    @State private var church = StudyChurchPresence()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text("GO DEEPER").appFont(.caption.weight(.semibold)).tracking(3).foregroundStyle(theme.textMuted)
                Text("Room to understand.").appFont(.custom(FontFamily.verse, size: 32)).foregroundStyle(theme.text)
                Text("Keep what you learn. Explore the people, places, and words of Scripture.")
                    .appFont(.body).foregroundStyle(theme.textMuted)
                DailyWalkRow(symbol: "note.text", title: "Notes", detail: "Your notes, folders, and Scripture connections") { onOpen(.notes) }
                    .spotlightTarget(.studyNotes)
                    .id(AppTarget.studyNotes)
                sectionLabel("EXPLORE SCRIPTURE")
                DailyWalkRow(symbol: "clock", title: "Bible timeline", detail: "Follow the events of Scripture through time") { onOpen(.timeline) }
                DailyWalkRow(symbol: "person.2", title: "People of the Bible", detail: "Lives, families, and where their stories meet") { onOpen(.people) }
                DailyWalkRow(symbol: "map", title: "Places & atlas", detail: "Explore the lands and journeys of the Bible") { onOpen(.places) }
                DailyWalkRow(symbol: "character.book.closed", title: "Original languages", detail: "Hebrew, Greek, and Strong's word studies") { onOpen(.words) }
                if church.showsSection {
                    sectionLabel("YOUR CHURCH")
                    DailyWalkRow(symbol: "mic", title: "Sermon studies", detail: "Walk through your church's recorded messages") { onOpen(.sermons) }
                        .spotlightTarget(.studySermons)
                        .id(AppTarget.studySermons)
                    if church.showsAnnouncements {
                        DailyWalkRow(symbol: "megaphone", title: "Church announcements", detail: "Coming up at your church, with calendar links") { onOpen(.sermons) }
                    }
                }
            }.padding(Spacing.lg).frame(maxWidth: 680).frame(maxWidth: .infinity)
        }
        .spotlightScroll(to: [.studyNotes, .studySermons])
        .background { MeshBackground() }.navigationTitle("Study")
        // Every return to the hub, as Android's focus effect: a church just
        // saved in Settings, or a first study, shows up without a relaunch.
        .task { await refreshChurch() }
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title).appFont(.caption.weight(.semibold)).tracking(2).foregroundStyle(theme.textMuted)
            .padding(.top, Spacing.sm)
    }

    private func refreshChurch() async {
        do {
            let home = try await SermonStudiesAPI.home(api: app.api)
            guard !Task.isCancelled else { return }
            church = StudyChurchPresence(home)
        } catch {
            guard !Task.isCancelled else { return }
            church = StudyChurchPresence()
        }
    }
}

/// Uses the existing word study instead of inventing a separate dictionary.
struct OriginalLanguagesHome: View {
    @Environment(AppModel.self) private var app
    @Environment(\.theme) private var theme
    @State private var query = "John 3:16"
    @State private var target = ConnectionsPlace(order: 43, chapter: 3, verse: 16)
    @State private var error: String?
    @State private var handoffTask: Task<Void, Never>?
    @State private var handoffID = UUID()
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text("The words behind the verse").appFont(.custom(FontFamily.verse, size: 28))
                Text("Enter a single verse to explore its Hebrew or Greek alongside the KJV wording.").foregroundStyle(theme.textMuted)
                HStack {
                    TextField("John 3:16", text: $query).textFieldStyle(.roundedBorder).onSubmit(open)
                    Button("Study", action: open).buttonStyle(.bordered)
                }
                if let error { Text(error).foregroundStyle(theme.danger) }
                Text(target.reference).appFont(.headline)
                WordStudyView(api: app.api, book: target.order, chapter: target.chapter, verse: target.verse ?? 1) { prompt, attach in
                    handoffTask?.cancel()
                    let id = UUID()
                    handoffID = id
                    let session = app
                    app.chat.input = prompt
                    // A failed/offline lookup must leave this request without
                    // passage context, never reuse an earlier Chat attachment.
                    app.chat.attachment = nil
                    if attach {
                        let place = target
                        handoffTask = Task {
                            let verses = try? await BibleTranslations.chapter(.kjv, order: place.order, chapter: place.chapter)
                            guard !Task.isCancelled, handoffID == id, app === session,
                                  target == place, session.section.primary == .study,
                                  session.chat.input == prompt, session.chat.attachment == nil else { return }
                            let index = (place.verse ?? 1) - 1
                            if let verses, verses.indices.contains(index) {
                                session.chat.attachment = VerseAttachment(reference: place.reference, text: VerseMarkup.plainText(verses[index]), translation: .kjv)
                            }
                            session.section = .chat
                        }
                    } else { app.section = .chat }
                }.id(target)
            }.padding(Spacing.lg).frame(maxWidth: 680).frame(maxWidth: .infinity)
        }.background { MeshBackground() }.navigationTitle("Original languages")
        .onDisappear { handoffTask?.cancel() }
    }
    private func open() {
        guard let reference = Bible.resolveReference(query), let verse = reference.verse else {
            error = "Enter a single verse such as John 3:16."
            return
        }
        error = nil
        target = ConnectionsPlace(order: reference.order, chapter: reference.chapter, verse: verse)
    }
}
