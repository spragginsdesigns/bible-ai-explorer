import SwiftUI

// MARK: - Release notes screen

/// Settings -> What's new: every release, newest first, from the same public
/// `GET /api/whats-new` the web journal and Android read. The catch-up
/// sheet's "Read more" opens it on one release (`focus`).
struct WhatsNewView: View {
    @Environment(\.theme) private var theme

    let api: APIClient
    /// "Try it" on a release card; nil hides the button.
    var onTry: ((WhatsNewDestination) -> Void)? = nil

    @State private var document: WhatsNewDocument?
    @State private var failed = false
    @State private var query = ""
    @State private var kind: WhatsNewKind?
    @State private var limit = WhatsNewRules.pageSize
    @State private var focus: String?

    init(api: APIClient, focus: String? = nil, onTry: ((WhatsNewDestination) -> Void)? = nil) {
        self.api = api
        self.onTry = onTry
        _focus = State(initialValue: focus)
    }

    private var matching: [WhatsNewEntry] {
        guard let document else { return [] }
        if let focus { return document.entries.filter { $0.version == focus } }
        return WhatsNewRules.filter(document.entries, query: query, kind: kind)
    }

    /// Browsing pages through the list; searching or filtering shows every match.
    private var browsing: Bool {
        focus == nil && query.trimmingCharacters(in: .whitespaces).isEmpty && kind == nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if let document {
                    content(document)
                } else if failed {
                    Text("Couldn't load the release notes. Check your connection and try again.")
                        .appFont(.callout)
                        .foregroundStyle(theme.textMuted)
                    Button("Try again") { Task { await load() } }
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel("Loading release notes")
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(theme.bg)
        .navigationTitle("What's new")
        .task { if document == nil { await load() } }
    }

    private func load() async {
        failed = false
        do {
            let data = try await api.publicData("/api/whats-new")
            document = try JSONDecoder().decode(WhatsNewDocument.self, from: data)
        } catch {
            failed = true
        }
    }

    @ViewBuilder
    private func content(_ document: WhatsNewDocument) -> some View {
        let matching = matching
        let shown = browsing ? Array(matching.prefix(limit)) : matching
        let remaining = matching.count - shown.count

        Text("Every update, newest first. Version numbers are the Android app's, where SureWord's features arrive first.")
            .appFont(.callout)
            .foregroundStyle(theme.textMuted)

        if focus != nil {
            Button("Show every release") { focus = nil }
        } else {
            TextField("Search release notes", text: $query)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Search release notes")
            Picker("Change type", selection: $kind) {
                Text("All").tag(WhatsNewKind?.none)
                ForEach(WhatsNewKind.allCases, id: \.self) { option in
                    Text(option.label).tag(WhatsNewKind?.some(option))
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            Text(browsing
                ? "\(document.entries.count) releases"
                : "\(matching.count) \(matching.count == 1 ? "release" : "releases") found")
                .appFont(.footnote)
                .foregroundStyle(theme.textFaint)
        }

        if shown.isEmpty {
            Text("No release notes match. Try another word or change type.")
                .appFont(.callout)
                .foregroundStyle(theme.textMuted)
        }

        ForEach(WhatsNewRules.groupByMonth(shown), id: \.month) { group in
            monthLabel(group.month)
            ForEach(group.entries) { entry in
                ReleaseCard(entry: entry, onTry: tryAction(for: entry))
            }
        }

        if browsing && remaining > 0 {
            Button("Show older releases (\(remaining) more)") { limit += WhatsNewRules.pageSize * 2 }
                .padding(.top, Spacing.sm)
        }

        if browsing && remaining == 0 {
            monthLabel(document.beginning.dateRange)
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(document.beginning.title)
                    .appFont(.custom(FontFamily.verse, size: 24))
                    .foregroundStyle(theme.text)
                Text(document.beginning.summary)
                    .foregroundStyle(theme.textSecondary)
                ForEach(document.beginning.items, id: \.self) { item in
                    Text("\u{2022}  \(item)")
                        .appFont(.callout)
                        .foregroundStyle(theme.textSecondary)
                }
            }
            .whatsNewCard(theme)
        }
    }

    private func tryAction(for entry: WhatsNewEntry) -> (() -> Void)? {
        guard let onTry, let target = entry.target, let destination = WhatsNewRules.destination(for: target) else {
            return nil
        }
        return { onTry(destination) }
    }

    private func monthLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .appFont(.caption.weight(.bold))
            .tracking(2)
            .foregroundStyle(theme.accentDim)
            .padding(.top, Spacing.lg)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct ReleaseCard: View {
    @Environment(\.theme) private var theme

    let entry: WhatsNewEntry
    let onTry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                Text(WhatsNewRules.primaryKind(entry).label.uppercased())
                    .appFont(.caption2.weight(.bold))
                    .tracking(1)
                    .foregroundStyle(theme.accent)
                    .padding(.horizontal, Spacing.sm)
                    .padding(.vertical, 2)
                    .background(theme.accentSoft, in: .capsule)
                Text("\(entry.version) · \(WhatsNewRules.formatDate(entry.date))")
                    .appFont(.footnote)
                    .foregroundStyle(theme.textFaint)
            }
            Text(entry.title)
                .appFont(.custom(FontFamily.verse, size: 24))
                .foregroundStyle(theme.text)
                .accessibilityAddTraits(.isHeader)
            if let headline = entry.headline {
                Text(headline).foregroundStyle(theme.textSecondary)
            }
            if let why = entry.why {
                Text(why).appFont(.callout).foregroundStyle(theme.textMuted)
            }
            ForEach(entry.sections, id: \.kind) { section in
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(section.kind.label)
                        .appFont(.footnote.weight(.bold))
                        .foregroundStyle(theme.accent)
                    ForEach(section.items, id: \.self) { item in
                        Text("\u{2022}  \(item)")
                            .appFont(.callout)
                            .foregroundStyle(theme.textSecondary)
                    }
                }
                .padding(.top, Spacing.xs)
            }
            if let verse = entry.verse {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("\u{201C}\(verse.text)\u{201D}")
                        .appFont(.custom(FontFamily.verseItalic, size: 18))
                        .foregroundStyle(theme.text)
                    Text(verse.reference)
                        .appFont(.footnote)
                        .foregroundStyle(theme.accentDim)
                }
                .padding(.leading, Spacing.md)
                .overlay(alignment: .leading) {
                    Rectangle().fill(theme.accentBorder).frame(width: 2)
                }
                .padding(.top, Spacing.sm)
            }
            if let onTry {
                Button("Try it", action: onTry)
                    .buttonStyle(.borderedProminent)
                    .tint(theme.accent)
                    .accessibilityLabel("Try \(entry.title)")
                    .padding(.top, Spacing.xs)
            }
        }
        .whatsNewCard(theme)
    }
}

private extension View {
    func whatsNewCard(_ theme: SureWordColors) -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.lg)
            .background(theme.surface, in: .rect(cornerRadius: 16))
            .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(theme.border, lineWidth: 1) }
    }
}

// MARK: - Catch-up sheet

/// "Since you were last here": up to three cards for the releases since this
/// account last looked, the Android and web sheet's copy word for word.
struct WhatsNewCatchUpSheet: View {
    @Environment(\.theme) private var theme

    let catchUp: WhatsNewCatchUp
    /// Closes the sheet and then runs the chosen action, so a second sheet or
    /// a section change never races the dismissal.
    let onClose: (WhatsNewCatchUpPresenter.Action?) -> Void

    var body: some View {
        let more = catchUp.newReleaseCount - catchUp.cards.count
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                Text("Since you were last here")
                    .appFont(.custom(FontFamily.verse, size: 28))
                    .foregroundStyle(theme.text)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Text("\(catchUp.newReleaseCount) \(catchUp.newReleaseCount == 1 ? "update" : "updates")")
                    .appFont(.caption.weight(.bold))
                    .foregroundStyle(theme.bg)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.xs)
                    .background(theme.accent, in: .capsule)
            }
            ScrollView {
                VStack(spacing: Spacing.md) {
                    ForEach(catchUp.cards) { card in
                        cardView(card)
                    }
                }
            }
            Button {
                onClose(.allNotes)
            } label: {
                HStack {
                    Text(more > 0 ? "See all release notes (\(more) more)" : "See all release notes")
                    Spacer()
                    Image(systemName: "chevron.right").accessibilityHidden(true)
                }
                .appFont(.callout.weight(.semibold))
                .foregroundStyle(theme.accent)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(minHeight: 44)
            Button {
                onClose(nil)
            } label: {
                Text("Got it").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .keyboardShortcut(.cancelAction)
        }
        .padding(Spacing.xl)
        .background(theme.bgElevated)
    }

    private func cardView(_ card: WhatsNewCatchUp.Card) -> some View {
        let destination = card.target.flatMap(WhatsNewRules.destination(for:))
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            Label(card.version, systemImage: "sparkles")
                .appFont(.caption.weight(.bold))
                .foregroundStyle(theme.accent)
            Text(card.title)
                .appFont(.custom(FontFamily.verse, size: 21))
                .foregroundStyle(theme.text)
            Text(card.summary)
                .appFont(.callout)
                .foregroundStyle(theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                onClose(destination.map { .open($0) } ?? .release(card.version))
            } label: {
                Text(destination == nil ? "Read more" : "Try it").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.accent)
            .accessibilityLabel("\(destination == nil ? "Read more about" : "Try") \(card.title)")
        }
        .whatsNewCard(theme)
    }
}

// MARK: - Presenter

extension View {
    /// Mount once at the signed-in root, beside `aiConsentPresenter`. Once per
    /// launch and account, after the consent sheet has been answered, it asks
    /// the server what this account has not seen and shows the sheet when an
    /// update brought something new. Any way of closing it records the
    /// releases as seen on the account, so no other device shows them again.
    func whatsNewPresenter(_ app: AppModel) -> some View {
        modifier(WhatsNewCatchUpPresenter(app: app))
    }
}

struct WhatsNewCatchUpPresenter: ViewModifier {
    enum Action: Equatable {
        case open(WhatsNewDestination)
        case release(String)
        case allNotes
    }

    /// The release notes opened from the sheet, optionally on one release.
    private struct NotesRequest: Identifiable {
        let id = UUID()
        let focus: String?
    }

    @Environment(\.theme) private var theme

    let app: AppModel
    @State private var catchUp: WhatsNewCatchUp?
    @State private var checkedFor: String?
    @State private var pendingAction: Action?
    /// What to record once the sheet closes, kept apart from `catchUp`
    /// because the sheet's binding is already nil by the time it has gone.
    @State private var lastSeen: Int?
    @State private var notes: NotesRequest?

    private var consentSettled: Bool {
        let consent = app.aiConsent
        return (consent.record != nil || consent.declined) && consent.prompt == nil
    }

    private var checkKey: String {
        "\(app.aiConsent.account ?? "")|\(consentSettled)"
    }

    func body(content: Content) -> some View {
        content
            .task(id: checkKey) { await check() }
            .sheet(item: $catchUp, onDismiss: finish) { catchUp in
                WhatsNewCatchUpSheet(catchUp: catchUp) { action in
                    pendingAction = action
                    self.catchUp = nil
                }
                .environment(\.theme, theme)
                #if os(macOS)
                .frame(width: 520, height: 620)
                #else
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                #endif
            }
            .sheet(item: $notes) { request in
                NavigationStack {
                    WhatsNewView(api: app.api, focus: request.focus) { destination in
                        notes = nil
                        open(destination)
                    }
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { notes = nil }
                        }
                    }
                }
                .environment(\.theme, theme)
                #if os(macOS)
                .frame(width: 560, height: 680)
                #endif
            }
    }

    private func check() async {
        guard consentSettled, let account = app.aiConsent.account, checkedFor != account else { return }
        checkedFor = account
        do {
            let result = try await app.api.json(WhatsNewRules.catchUpPath, as: WhatsNewCatchUp.self)
            if !result.cards.isEmpty, app.aiConsent.account == account {
                lastSeen = result.seenUpTo
                catchUp = result
            }
        } catch {
            // Offline or signed out mid-flight: nothing to show, try next launch.
            checkedFor = nil
        }
    }

    /// Every close lands here: swipe, Escape, Got it, a card or See all.
    private func finish() {
        if let seen = lastSeen {
            let api = app.api
            Task {
                // An unrecorded close shows the sheet once more next launch; harmless.
                _ = try? await api.data("/api/whats-new/catch-up", method: "POST", body: WhatsNewSeenBody(versionCode: seen))
            }
        }
        lastSeen = nil
        let action = pendingAction
        pendingAction = nil
        switch action {
        case .open(let destination): open(destination)
        case .release(let version): notes = NotesRequest(focus: version)
        case .allNotes: notes = NotesRequest(focus: nil)
        case nil: break
        }
    }

    private func open(_ destination: WhatsNewDestination) {
        WhatsNewNavigation.open(destination, in: app)
    }
}

/// Opens a release's feature through the hooks each shell already observes:
/// the selected section, the Daily Cross notification, the Today stack's
/// pending destination and the Study hub's.
@MainActor
enum WhatsNewNavigation {
    static func open(_ destination: WhatsNewDestination, in app: AppModel) {
        switch destination {
        case .section(let section):
            app.section = section
        case .cross:
            #if os(macOS)
            PendingDeepLinks.shared.post(.cross)
            #else
            NotificationCenter.default.post(name: .openDailyCross, object: nil)
            #endif
        case .daily(let daily):
            app.pendingDailyDestination = daily
            app.section = .today
        case .study(let page):
            StudyHubNavigation.open(page, in: app)
        }
    }
}
