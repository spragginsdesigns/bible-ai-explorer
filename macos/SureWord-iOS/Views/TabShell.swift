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
    @Environment(\.scenePhase) private var scenePhase

    /// Home is Chat, matching Android's initial route.
    @State private var selectedTab: AppSection = UIEvidenceHarness.initialShellTab
    /// The Daily Cross has no tab of its own (on Android it lives inside Chat
    /// as the pushed `/cross` route); here it is a sheet over whichever tab is
    /// frontmost, so the morning notification can open it from anywhere.
    @State private var isCrossPresented = false
    /// A share is being read off disk; guards against a second read racing it.
    @State private var isOpeningShare = false
    /// Bumped when the deferred permission dialog is granted, so the
    /// notification sync runs again with permission in hand.
    @State private var permissionGrants = 0
    @State private var permissionListener: UUID?

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab(AppSection.chat.title, systemImage: "bubble.left.and.bubble.right", value: .chat) {
                NavigationStack {
                    ChatTabView()
                        .analyticsScreen(AnalyticsScreen.chat)
                }
            }
            Tab(AppSection.bible.title, systemImage: AppSection.bible.symbol, value: .bible) {
                NavigationStack {
                    BibleTabView()
                        .analyticsScreen(AnalyticsScreen.bible)
                }
            }
            Tab(AppSection.notes.title, systemImage: AppSection.notes.symbol, value: .notes) {
                NavigationStack {
                    NotesTabView()
                        .analyticsScreen(AnalyticsScreen.notes)
                }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .task { app.bible.reading.setForeground(scenePhase == .active); await app.chat.loadConversations() }
        // First hydrate of the session: the server document replaces whatever
        // this phone had cached for the synced preferences.
        .task { app.preferences.refresh(force: true) }
        .onChange(of: selectedTab) { _, tab in if tab != .bible { app.bible.reading.setReaderVisible(false) } }
        .onChange(of: isCrossPresented) { _, visible in app.bible.reading.setObscured(visible, reason: "cross") }
        // Every way into the Daily Cross presents this sheet, so this is the
        // "first Cross visit" moment for the permission dialog.
        .onChange(of: isCrossPresented) { _, visible in
            if visible { NotificationPermissionMoments.shared.signal(.crossVisit) }
        }
        // The tab root under the Cross sheet does not reappear when it closes,
        // so its screen is reported from here.
        .onChange(of: isCrossPresented) { _, visible in
            if !visible { Analytics.shared.screen(AnalyticsScreen.pattern(for: selectedTab)) }
        }
        // Keep the push token and the morning reminder in step with the
        // settings, on every launch and on every change. Launch never opens
        // the permission dialog (PRD B6a): this only reads the status, and the
        // dialog waits for one of the moments below.
        .task(id: notificationSyncKey) {
            await PushRegistration.syncAll(api: app.api, settings: app.settings)
        }
        // APNs answers registration asynchronously; when a token arrives, run
        // the server registration with it.
        .onReceive(NotificationCenter.default.publisher(for: .pushTokenDidChange)) { _ in
            Task { await PushRegistration.syncAll(api: app.api, settings: app.settings) }
        }
        // The one listener for permission moments: a settled chat answer
        // (`ChatViewModel`), the first Daily Cross visit and a Settings switch.
        .onAppear {
            guard permissionListener == nil else { return }
            permissionListener = NotificationPermissionMoments.shared.subscribe { trigger in
                Task {
                    if await NotificationPermissionCoordinator.handle(trigger, settings: app.settings) {
                        permissionGrants += 1
                    }
                }
            }
        }
        // The shell goes away on sign-out; the next one subscribes afresh.
        .onDisappear {
            if let permissionListener { NotificationPermissionMoments.shared.unsubscribe(permissionListener) }
            permissionListener = nil
        }
        // Providers, church and the memory count, warmed for this account so
        // Settings opens on its real content (PRD B7).
        .task { await SettingsDataStore.shared.prefetch(.live(app.api)) }
        .onReceive(NotificationCenter.default.publisher(for: .openDailyCross)) { _ in
            openCross()
        }
        // A preference changed on the Mac or the web should be here by the time
        // the app is looked at again. `refresh` throttles itself.
        .onChange(of: scenePhase) { _, phase in
            app.bible.reading.setForeground(phase == .active)
            guard phase == .active else { return }
            app.preferences.refresh()
            // Android reloads the open day on resume, so a Cross left up
            // overnight shows today rather than yesterday.
            if isCrossPresented { app.dailyCross.load(force: true) }
            openPendingShare()
        }
        // "Share into SureWord". This shell only exists signed in, so a share
        // made signed out waits in the inbox and opens on first appearance,
        // right after sign-in - the journey Android proved signed out.
        .task { openPendingShare() }
        .onReceive(NotificationCenter.default.publisher(for: .pendingShareArrived)) { _ in
            openPendingShare()
        }
        // An upload already running would make the share's upload bail out,
        // so a share that arrived mid-upload opens once it finishes.
        .onChange(of: app.chat.uploadingAttachments) { _, uploading in
            if !uploading { openPendingShare() }
        }
        // Settings is pushed inside this shell rather than presented over it,
        // so one alert here covers a failed PATCH from Settings and from the
        // reader alike. The model picker is a sheet and owns its own - an
        // alert under a presented sheet never appears.
        .preferencesErrorAlert(app.preferences, isActive: !app.preferences.isAlertOwnedBySheet)
        // A sureword://verse deep link (or an older verse-carrying push): open
        // the reader at the reference. `BibleModel.open` sets the pending verse
        // Lane 2's reader scrolls to and flashes.
        .onReceive(NotificationCenter.default.publisher(for: .openVerseReference)) { note in
            openVerse(note.object as? String)
        }
        // A tapped "your answer is ready" push: that conversation, on Chat.
        .onReceive(NotificationCenter.default.publisher(for: .openConversation)) { note in
            if let id = note.object as? String { openConversation(id) }
        }
        // A verse card tapped in chat: same journey as a verse deep link, with
        // the reference in userInfo instead of the object (Lane 3's
        // `ChatRouting`). The shell is the single writer of
        // `pendingVerseReference`, so the Bible tab root consumes it once.
        .onReceive(NotificationCenter.default.publisher(for: .openBibleVerse)) { note in
            openVerse(
                note.userInfo?["reference"] as? String,
                translation: note.userInfo?["translation"] as? String
            )
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
                case .chat(let conversationID): openConversation(conversationID)
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
                .analyticsScreen(AnalyticsScreen.cross)
            }
            .presentationDragIndicator(.visible)
        }
    }

    /// Open the waiting share, if any, as a new chat on the Chat tab. The read
    /// (up to five files, photos re-encoded) runs off the main actor; taking it
    /// empties the inbox, so it is applied once.
    private func openPendingShare() {
        guard !isOpeningShare, !app.chat.uploadingAttachments,
              let store = PendingShareStore.appGroup(), store.hasPending
        else { return }
        isOpeningShare = true
        Task {
            let draft = await Task.detached(priority: .userInitiated) {
                ShareInboxIntake.takeDraft(from: store)
            }.value
            isOpeningShare = false
            guard let draft else { return }
            isCrossPresented = false
            app.chat.isHistoryPresented = false
            selectedTab = .chat
            await app.chat.startSharedChat(draft)
        }
    }

    private func openCross() {
        app.chapterAudio.close()
        isCrossPresented = true
        app.dailyCross.load(force: true)
    }

    private func openVerse(_ raw: String?, translation: String? = nil) {
        // The documented reader hook: the Bible tab root observes
        // `pendingVerseReference`, resolves it, and pushes the reader itself
        // (see `BibleTabView`). Raw string, not a resolved Reference —
        // resolution is the consumer's job, and an unresolvable reference is
        // dropped there exactly as Android no-ops it.
        guard let raw, Bible.resolveReference(raw) != nil else { return }
        app.pendingVerseTranslation = translation.flatMap(TranslationID.init(rawValue:))
        app.pendingVerseReference = raw
        selectedTab = .bible
    }

    /// Android's `router.push("/", { conversationId })` for a chat push tap.
    private func openConversation(_ id: String) {
        guard !id.isEmpty else { return }
        isCrossPresented = false
        app.chat.isHistoryPresented = false
        selectedTab = .chat
        Task { await app.chat.switchConversation(to: id) }
    }

    /// Everything the notification sync depends on, so a change to any of
    /// them (or a fresh permission grant) re-runs it.
    private var notificationSyncKey: String {
        "\(app.settings.verseOfDayEnabled)-\(app.settings.verseOfDayHour)-\(app.settings.notifyChatReplies)-\(permissionGrants)"
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
