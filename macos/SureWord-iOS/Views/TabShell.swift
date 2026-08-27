import SwiftUI

/// Signed-in shell: the iOS 26 native tab bar (Liquid Glass comes free) with
/// the three primary sections from Android's bottom tabs
/// (`mobile/app/(app)/_layout.tsx`) — Chat (home), Bible, Notes. Settings and
/// Memories are push-only routes reached from the toolbar gear, as on Android.
/// The Daily Cross has no tab of its own (on Android it's the pushed `/cross`
/// route inside Chat); here it's a sheet, opened from the morning
/// notification, a `sureword://cross` deep link, or the Bible header card.
struct TabShell: View {
    @Environment(AppModel.self) private var app

    /// Home is Chat, matching Android's initial route.
    @State private var selectedTab: AppSection = .chat
    /// The Daily Cross has no tab of its own (on Android it lives inside Chat
    /// as the pushed `/cross` route); here it is a sheet over whichever tab is
    /// frontmost, so the morning notification can open it from anywhere.
    @State private var isCrossPresented = false

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab(AppSection.chat.title, systemImage: "bubble.left.and.bubble.right", value: .chat) {
                NavigationStack {
                    ChatTabView()
                }
            }
            Tab(AppSection.bible.title, systemImage: AppSection.bible.symbol, value: .bible) {
                NavigationStack {
                    BibleTabView()
                }
            }
            Tab(AppSection.notes.title, systemImage: AppSection.notes.symbol, value: .notes) {
                NavigationStack {
                    NotesTabView()
                }
            }
        }
        .task { await app.chat.loadConversations() }
        // Keep the morning reminder in step with the settings, on every launch
        // and on every change to either half of the preference. Enabling the
        // toggle in Settings re-runs this, and `sync` is what requests
        // notification authorization at that moment.
        .task(id: "\(app.settings.verseOfDayEnabled)-\(app.settings.verseOfDayHour)") {
            await DailyCrossNotifications.sync(
                enabled: app.settings.verseOfDayEnabled,
                hour: app.settings.verseOfDayHour
            )
            await syncPushToken()
        }
        // APNs answers registration asynchronously; when a token arrives, run
        // the server registration with it.
        .onReceive(NotificationCenter.default.publisher(for: .pushTokenDidChange)) { _ in
            Task { await syncPushToken() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .openDailyCross)) { _ in
            openCross()
        }
        // A sureword://verse deep link (or an older verse-carrying push): open
        // the reader at the reference. `BibleModel.open` sets the pending verse
        // Lane 2's reader scrolls to and flashes.
        .onReceive(NotificationCenter.default.publisher(for: .openVerseReference)) { note in
            openVerse(note.object as? String)
        }
        // A verse card tapped in chat: same journey as a verse deep link, with
        // the reference in userInfo instead of the object (Lane 3's
        // `ChatRouting`). The shell is the single writer of
        // `pendingVerseReference`, so the Bible tab root consumes it once.
        .onReceive(NotificationCenter.default.publisher(for: .openBibleVerse)) { note in
            openVerse(note.userInfo?["reference"] as? String)
        }
        // A note receipt tapped in chat: stage the note for the Notes tab root
        // (the `pendingVerseReference` pattern) and switch tabs; the root
        // pushes the editor itself.
        .onReceive(NotificationCenter.default.publisher(for: .openNote)) { note in
            guard let noteID = note.userInfo?["noteId"] as? String, !noteID.isEmpty else { return }
            app.pendingNoteID = noteID
            selectedTab = .notes
        }
        // The reader's "Ask AI" / "Expand with AI" actions have already put the
        // passage on `app.chat.attachment`; the shell just switches tabs.
        .onReceive(NotificationCenter.default.publisher(for: .openChatWithAttachment)) { _ in
            selectedTab = .chat
        }
        // Links that arrived before this shell existed — the cold start from a
        // notification tap, where the app delegate fired before Clerk restored
        // the session.
        .task {
            for link in PendingDeepLinks.shared.drain() {
                switch link {
                case .cross: openCross()
                case .verse(let reference): openVerse(reference)
                }
            }
        }
        .sheet(isPresented: $isCrossPresented) {
            NavigationStack {
                CrossView(
                    onOpenReader: {
                        isCrossPresented = false
                        selectedTab = .bible
                    },
                    onOpenChat: {
                        isCrossPresented = false
                        selectedTab = .chat
                    }
                )
            }
            .presentationDragIndicator(.visible)
        }
    }

    private func openCross() {
        isCrossPresented = true
        app.dailyCross.load(force: true)
    }

    private func openVerse(_ raw: String?) {
        // The documented reader hook: the Bible tab root observes
        // `pendingVerseReference`, resolves it, and pushes the reader itself
        // (see `BibleTabView`). Raw string, not a resolved Reference —
        // resolution is the consumer's job, and an unresolvable reference is
        // dropped there exactly as Android no-ops it.
        guard let raw, Bible.resolveReference(raw) != nil else { return }
        app.pendingVerseReference = raw
        selectedTab = .bible
    }

    private func syncPushToken() async {
        await PushRegistration.sync(
            api: app.api,
            enabled: app.settings.verseOfDayEnabled,
            hour: app.settings.verseOfDayHour
        )
    }
}

extension View {
    /// The push-only route into Settings, mirrored on every tab root's toolbar.
    /// Later lanes replacing the placeholder tab views should keep this
    /// modifier on their own roots so the gear stays reachable everywhere.
    func settingsGearToolbar() -> some View {
        toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    SettingsView()
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("Settings")
            }
        }
    }
}
