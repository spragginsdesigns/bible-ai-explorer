import SwiftUI

/// Ways to Serve (GitHub issue #28), shared by macOS (pushed inside the Today
/// section) and iOS (pushed on the Today tab, or from Settings).
///
/// Every word of Scripture and every way comes from `GET /api/serve`; this
/// view only lays it out and maps each way's action onto an Apple
/// destination (`ServeRules.target`). Nothing here is counted or scored: the
/// journal lists entries without a total, and no way reads as required.
struct WaysToServeView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL

    @Bindable var model: ServeModel

    private enum Field: Hashable { case location, journal }
    private enum Anchor: Hashable { case nearby, journal }

    private struct SendWordRequest: Identifiable {
        let reference: String
        var id: String { reference }
    }

    @FocusState private var focus: Field?
    @State private var scrollTarget: Anchor?
    @State private var sendWord: SendWordRequest?
    @State private var isChurchPresented = false
    @State private var pendingDelete: ServeEntry?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    content
                }
                .padding(Spacing.lg)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: scrollTarget) { _, target in
                guard let target else { return }
                withAnimation { proxy.scrollTo(target, anchor: .top) }
                scrollTarget = nil
            }
        }
        .background { MeshBackground() }
        .navigationTitle(model.view?.title ?? "Ways to Serve")
        .task {
            await model.refresh()
            await model.loadEntries()
        }
        .alert(
            model.errorAlert?.title ?? "",
            isPresented: Binding(
                get: { model.errorAlert != nil },
                set: { if !$0 { model.errorAlert = nil } }
            ),
            presenting: model.errorAlert
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { alert in
            Text(alert.message)
        }
        .sheet(item: $sendWord) { request in
            SendWordSheet(reference: request.reference, api: app.api) { sendWord = nil }
        }
        // The church decides which ways show, so the page reloads after it.
        .sheet(isPresented: $isChurchPresented, onDismiss: { Task { await model.refresh() } }) {
            ServeChurchSheet()
        }
        .confirmationDialog(
            "Delete this entry?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { entry in
            Button("Delete", role: .destructive) {
                Task { await model.deleteEntry(entry.id) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("It will be removed from your journal.")
        }
    }

    @ViewBuilder
    private var content: some View {
        if let view = model.view {
            loaded(view)
        } else if model.state == .failed {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Couldn't load Ways to Serve.")
                    .foregroundStyle(theme.textMuted)
                Button("Retry") { Task { await model.refresh() } }
                    .buttonStyle(.bordered)
            }
        } else {
            HStack {
                ProgressView()
                Spacer()
            }
        }
    }

    @ViewBuilder
    private func loaded(_ view: ServeView) -> some View {
        Text(view.title)
            .appFont(.custom(FontFamily.verse, size: 32))
            .foregroundStyle(theme.text)
            .fixedSize(horizontal: false, vertical: true)

        introBlock(view.intro)
        settingsCard(view)

        if let today = view.today {
            sectionLabel("TODAY")
            wayCard(today, in: view, emphasized: true)
        }

        if !view.ways.isEmpty {
            sectionLabel("WAYS TO SERVE")
            ForEach(view.ways) { way in
                wayCard(way, in: view, emphasized: false)
            }
        }

        if view.nearby.available {
            nearbySection(view.nearby)
                .id(Anchor.nearby)
        }

        journalSection(view.journal)
            .id(Anchor.journal)
    }

    // MARK: - Intro and settings

    private func introBlock(_ intro: ServeIntro) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(intro.text)
                .appFont(.body)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(Array(intro.verses.enumerated()), id: \.offset) { _, verse in
                scripture(verse, size: 19)
            }
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
    }

    private func settingsCard(_ view: ServeView) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            ServeModePicker(model: model)
            ServeGivesToggle(model: model)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
    }

    // MARK: - Ways

    private func wayCard(_ way: ServeWay, in view: ServeView, emphasized: Bool) -> some View {
        let target = ServeRules.target(
            for: way,
            nearbyAvailable: view.nearby.available,
            churchWebsite: view.church?.website
        )
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(way.title)
                .appFont(emphasized ? .title3.weight(.semibold) : .headline)
                .foregroundStyle(theme.text)
                .fixedSize(horizontal: false, vertical: true)
            Text(way.detail)
                .appFont(.subheadline)
                .foregroundStyle(theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            if !way.verse.reference.isEmpty {
                scripture(way.verse, size: 17)
            }
            if let target {
                Button(ServeRules.label(for: way.action, target: target)) { perform(target, way: way) }
                    .buttonStyle(.bordered)
                    .tint(theme.accent)
                    .padding(.top, Spacing.xs)
            }
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(emphasized ? theme.accentSoft : theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg)
                .strokeBorder(emphasized ? theme.accentBorder : theme.border, lineWidth: 1)
        }
    }

    private func perform(_ target: ServeActionTarget, way: ServeWay) {
        switch target {
        case .sendWord(let reference):
            sendWord = SendWordRequest(reference: reference)
        case .chat(let prompt):
            // Filled in, never sent: the reader decides what to ask.
            app.chat.input = prompt
            app.section = .chat
        case .focusNearby:
            scrollTarget = .nearby
            focus = .location
        case .focusJournal:
            // Saved with the entry, as on web and Android.
            model.journalVerse = way.verse.reference.isEmpty ? nil : way.verse.reference
            scrollTarget = .journal
            focus = .journal
        case .myChurch:
            isChurchPresented = true
        case .website(let url):
            openURL(url)
        }
    }

    // MARK: - Nearby

    private func nearbySection(_ nearby: ServeNearbyInfo) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            sectionLabel("NEARBY")
            TextField("City or ZIP", text: $model.location, prompt: Text("City or ZIP code"))
                .textFieldStyle(.roundedBorder)
                .focused($focus, equals: .location)
                .onChange(of: model.location) { _, value in
                    if value.count > ServeRules.maxLocationLength {
                        model.location = String(value.prefix(ServeRules.maxLocationLength))
                    }
                }
                .onSubmit {
                    if let first = model.nearbyKind ?? nearby.searches.first?.id {
                        Task { await model.searchNearby(kind: first) }
                    }
                }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    ForEach(nearby.searches) { search in
                        chip(search)
                    }
                }
            }
            nearbyResults
        }
    }

    @ViewBuilder
    private func chip(_ search: ServeNearbySearch) -> some View {
        let selected = model.nearbyKind == search.id
        if selected {
            Button(search.label) { Task { await model.searchNearby(kind: search.id) } }
                .buttonStyle(.borderedProminent)
                .disabled(!model.canSearchNearby)
        } else {
            Button(search.label) { Task { await model.searchNearby(kind: search.id) } }
                .buttonStyle(.bordered)
                .disabled(!model.canSearchNearby)
        }
    }

    @ViewBuilder
    private var nearbyResults: some View {
        switch model.nearby {
        case .idle:
            if !model.canSearchNearby {
                hint("Type a city or ZIP code, then pick what to look for.")
            }
        case .searching:
            HStack {
                ProgressView().controlSize(.small)
                Spacer()
            }
        case .unavailable:
            hint("Nearby search isn't available right now.")
        case .failed(let message):
            Text(message)
                .appFont(.footnote)
                .foregroundStyle(theme.danger)
        case .results(let places):
            if places.isEmpty {
                hint("Nothing found there. Try a nearby city.")
            } else {
                ForEach(places) { place in
                    placeRow(place)
                }
            }
        }
    }

    private func placeRow(_ place: ServePlace) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(place.name)
                .appFont(.headline)
                .foregroundStyle(theme.text)
            Text(place.address)
                .appFont(.footnote)
                .foregroundStyle(theme.textMuted)
            HStack(spacing: Spacing.md) {
                if let maps = place.mapsUrl, let url = URL(string: maps) {
                    Link(destination: url) { Label("Map", systemImage: "map") }
                }
                if let site = place.website, let url = ServeRules.safeWebsite(site) {
                    Link(destination: url) {
                        Label(ChurchRules.hostname(of: site) ?? "Website", systemImage: "globe")
                    }
                }
                if let phone = place.phone, let url = ChurchRules.telURL(for: phone) {
                    Link(destination: url) { Label(phone, systemImage: "phone") }
                }
            }
            .appFont(.footnote)
            .tint(theme.accent)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1) }
    }

    // MARK: - Journal

    private func journalSection(_ journal: ServeJournalInfo) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            sectionLabel(journal.title.uppercased())
            Text(journal.prompt)
                .appFont(.subheadline)
                .foregroundStyle(theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            if !journal.verse.reference.isEmpty {
                scripture(journal.verse, size: 17)
            }
            TextEditor(text: $model.draft)
                .focused($focus, equals: .journal)
                .scrollContentBackground(.hidden)
                .appFont(.body)
                .foregroundStyle(theme.text)
                .frame(minHeight: 96)
                .padding(Spacing.sm)
                .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1) }
                .accessibilityLabel(journal.title)
                .onChange(of: model.draft) { _, value in
                    if value.count > ServeRules.maxEntryLength {
                        model.draft = String(value.prefix(ServeRules.maxEntryLength))
                    }
                }
            if let verseRef = model.journalVerse {
                HStack {
                    Text("With \(verseRef)")
                        .appFont(.footnote)
                        .foregroundStyle(theme.textMuted)
                    Button("Remove") { model.journalVerse = nil }
                        .buttonStyle(.borderless)
                        .tint(theme.accent)
                        .accessibilityLabel("Remove \(verseRef)")
                }
            }
            HStack {
                Spacer()
                if model.isSavingEntry { ProgressView().controlSize(.small) }
                Button("Save") { Task { await model.saveEntry() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.canSaveEntry)
            }
            ForEach(model.entries) { entry in
                entryRow(entry)
            }
        }
    }

    private func entryRow(_ entry: ServeEntry) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(spacing: Spacing.sm) {
                    if let date = ServeRules.entryDate(entry.createdAt) {
                        Text(date, format: .dateTime.month(.abbreviated).day().year())
                    }
                    if let verse = entry.verseRef, !verse.isEmpty {
                        Text(verse)
                    }
                }
                .appFont(.caption.weight(.semibold))
                .foregroundStyle(theme.textMuted)
                Text(entry.text)
                    .appFont(.body)
                    .foregroundStyle(theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                pendingDelete = entry
            } label: {
                Image(systemName: "trash")
                    .foregroundStyle(theme.textMuted)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Delete entry")
        }
        .padding(Spacing.md)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1) }
    }

    // MARK: - Pieces

    private func scripture(_ verse: ServeVerse, size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if !verse.text.isEmpty {
                Text(verse.text)
                    .appFont(.custom(FontFamily.verseItalic, size: size))
                    .foregroundStyle(theme.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("\(verse.reference.uppercased()) · KJV")
                .appFont(.caption2.weight(.semibold))
                .tracking(1.5)
                .foregroundStyle(theme.textMuted)
        }
        .accessibilityElement(children: .combine)
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .appFont(.caption.weight(.semibold))
            .tracking(3)
            .foregroundStyle(theme.textMuted)
            .padding(.top, Spacing.sm)
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .appFont(.footnote)
            .foregroundStyle(theme.textMuted)
    }
}

// MARK: - Shared controls

/// Off / Nearby / Online / Both, written optimistically: the choice shows at
/// once and rolls back with an alert if the server refuses it.
struct ServeModePicker: View {
    @Bindable var model: ServeModel

    var body: some View {
        Picker(
            "Ways to Serve",
            selection: Binding(
                get: { model.mode },
                set: { mode in Task { await model.setMode(mode) } }
            )
        ) {
            ForEach(ServeMode.allCases) { mode in
                Text(mode.label).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .disabled(model.view == nil)
    }
}

struct ServeGivesToggle: View {
    @Bindable var model: ServeModel

    var body: some View {
        Toggle(
            "I already give to my church",
            isOn: Binding(
                get: { model.view?.settings.givesToChurch ?? false },
                set: { gives in Task { await model.setGivesToChurch(gives) } }
            )
        )
        .disabled(model.view == nil)
    }
}

/// The Settings section on both platforms: the same two choices as the page.
/// The host supplies the way into the page itself, since the Mac closes its
/// Settings window first and iOS pushes onto the Settings stack.
struct ServeSettingsSection<Open: View>: View {
    @Environment(AppModel.self) private var app
    @ViewBuilder let open: () -> Open

    var body: some View {
        Section("Ways to Serve") {
            ServeModePicker(model: app.serve)
            ServeGivesToggle(model: app.serve)
            open()
        }
        .task { if app.serve.view == nil { await app.serve.refresh() } }
    }
}

/// iOS Settings -> Ways to Serve.
struct ServeSettingsPage: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Form {
            ServeSettingsSection {
                NavigationLink("Open Ways to Serve") {
                    WaysToServeView(model: app.serve)
                }
            }
        }
        .navigationTitle("Ways to Serve")
        .analyticsScreen(AnalyticsScreen.settingsServe)
    }
}

/// My church in a sheet, for the "Ask your church" way. A sheet rather than a
/// trip to Settings so the reader lands back on the way they came from.
struct ServeChurchSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var church = ChurchModel()

    var body: some View {
        NavigationStack {
            Form {
                ChurchSectionView(model: church)
            }
            .formStyle(.grouped)
            .navigationTitle("My church")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 520)
        #endif
        .task {
            church.configure(app.api)
            await church.load()
        }
    }
}

/// The compact Today card: today's way, hidden whenever Ways to Serve is off
/// or nothing is suggested. Tapping it opens the page, never the action, so
/// nothing is done on the reader's behalf.
struct ServeTodayCard: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    let onOpen: () -> Void

    var body: some View {
        if let way = app.serve.todayCardWay {
            Button(action: onOpen) {
                HStack(spacing: Spacing.md) {
                    Image(systemName: "hands.sparkles")
                        .appFont(.system(size: 23, weight: .light))
                        .foregroundStyle(theme.accent)
                        .frame(width: 32)
                    VStack(alignment: .leading, spacing: 4) {
                        Text((app.serve.view?.title ?? "Ways to Serve").uppercased())
                            .appFont(.caption.weight(.semibold))
                            .tracking(2)
                            .foregroundStyle(theme.textMuted)
                        Text(way.title)
                            .appFont(.headline)
                            .foregroundStyle(theme.text)
                            .fixedSize(horizontal: false, vertical: true)
                        if !way.verse.reference.isEmpty {
                            Text(way.verse.reference)
                                .appFont(.subheadline)
                                .foregroundStyle(theme.textMuted)
                        }
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").foregroundStyle(theme.textMuted)
                }
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
                .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
                .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
                .contentShape(.rect(cornerRadius: Radius.lg))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Ways to Serve: \(way.title)")
        }
    }
}
