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
    @State private var reading: ContinueReadingModel?
    @State private var preview: DailyWalkPreview?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text("YOUR DAILY WALK").font(.caption.weight(.semibold)).tracking(3).foregroundStyle(theme.textMuted)
                Text("Begin with the Word.")
                    .font(.custom(FontFamily.verse, size: 34)).foregroundStyle(theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                DailyWalkArtwork().frame(height: 160).clipShape(.rect(cornerRadius: Radius.lg)).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Label("Pick Up Your Cross", systemImage: "cross")
                        .font(.custom(FontFamily.verse, size: 28)).foregroundStyle(theme.accent)
                    Text(preview?.text ?? "Thy word is a lamp unto my feet, and a light unto my path.")
                        .font(.custom(FontFamily.verse, size: 22)).foregroundStyle(theme.textSecondary)
                    Text("\((preview?.reference ?? "Psalm 119:105").uppercased()) · KJV").font(.caption.weight(.semibold)).tracking(2).foregroundStyle(theme.textMuted)
                    Button(action: onCross) {
                        HStack { Text("Read today's word"); Spacer(); Image(systemName: "arrow.right") }
                            .font(.headline).padding(.vertical, 8).frame(minHeight: 42)
                    }
                    .buttonStyle(.borderedProminent).padding(.top, Spacing.sm)
                }
                if let last = reading?.lastRead {
                    DailyWalkRow(symbol: "book", title: "Continue reading", detail: last.label) { open(last) }
                } else {
                    DailyWalkRow(symbol: "book", title: "Open the Bible", detail: "A quiet place to read") { app.section = .bible }
                }
                DailyWalkRow(symbol: "calendar", title: app.bible.plan.plan?.title ?? "Reading plan", detail: PlanView.planCardSubtitle(app.bible.plan.plan), action: onPlan)
                DailyWalkRow(symbol: "square.stack.3d.up", title: "Learn a verse", detail: "Carry Scripture with you", action: onLearn)
                DailyWalkRow(symbol: "clock.arrow.circlepath", title: "Your walk", detail: "Your reading log and reflections", action: onHistory)
                SendWordHomeCard(titleSize: 16, subtitleSize: 13)
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .background { MeshBackground() }
        .navigationTitle("Today")
        .task {
            if reading == nil { reading = ContinueReadingModel(api: app.api) }
            await reading?.refresh()
            app.bible.plan.loadIfNeeded()
            await refreshPreview()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await reading?.refresh(); await refreshPreview() } }
        }
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
                Image(systemName: symbol).font(.system(size: 23, weight: .light)).foregroundStyle(theme.accent).frame(width: 32)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline).foregroundStyle(theme.text)
                    Text(detail).font(.subheadline).foregroundStyle(theme.textMuted).fixedSize(horizontal: false, vertical: true)
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
            Image(systemName: "sun.horizon").font(.system(size: 54, weight: .ultraLight)).foregroundStyle(.white.opacity(0.65))
        }
    }
}

struct StudyHome: View {
    @Environment(\.theme) private var theme
    let onNotes: () -> Void
    let onAtlas: () -> Void
    let onSermons: () -> Void
    let onWords: () -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text("GO DEEPER").font(.caption.weight(.semibold)).tracking(3).foregroundStyle(theme.textMuted)
                Text("Room to understand.").font(.custom(FontFamily.verse, size: 32)).foregroundStyle(theme.text)
                Text("Keep what you discover. Explore the people, places, and words of Scripture.")
                    .font(.body).foregroundStyle(theme.textMuted)
                DailyWalkRow(symbol: "note.text", title: "Notes", detail: "Your thoughts, linked verses, and study notebooks", action: onNotes)
                DailyWalkRow(symbol: "globe.europe.africa", title: "Timeline, People & Places", detail: "The Bible atlas, journeys, and history", action: onAtlas)
                DailyWalkRow(symbol: "building.columns", title: "Sermon studies & church", detail: "Messages, study guides, and church announcements", action: onSermons)
                DailyWalkRow(symbol: "character.book.closed", title: "Original languages", detail: "Explore Hebrew, Greek, and Strong's word studies", action: onWords)
            }.padding(Spacing.lg).frame(maxWidth: 680).frame(maxWidth: .infinity)
        }.background { MeshBackground() }.navigationTitle("Study")
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
                Text("The words behind the verse").font(.custom(FontFamily.verse, size: 28))
                Text("Enter a single verse to explore its Hebrew or Greek alongside the KJV wording.").foregroundStyle(theme.textMuted)
                HStack {
                    TextField("John 3:16", text: $query).textFieldStyle(.roundedBorder).onSubmit(open)
                    Button("Study", action: open).buttonStyle(.bordered)
                }
                if let error { Text(error).foregroundStyle(theme.danger) }
                Text(target.reference).font(.headline)
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
