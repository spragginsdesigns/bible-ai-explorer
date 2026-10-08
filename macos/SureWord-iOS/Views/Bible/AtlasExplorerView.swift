import SwiftUI

/// Native iOS Timeline, People, and Places explorer, held to Android's
/// `mobile/app/(app)/bible/timeline.tsx` and the `atlas/*` routes (the source
/// of truth). The model is shared with macOS and with every explorer pushed in
/// this stack, so each screen keeps its own filters (mode, era, scope,
/// journey) and reloads the model on appear when another screen replaced
/// what it shows.
struct AtlasExplorerView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    @Bindable var model: AtlasModel
    let scopedBook: Int?
    let scopedChapter: Int?
    let journeyPersonID: String?

    @State private var mode: AtlasExplorerMode = .timeline
    /// This screen's era. Never read back from the shared model, so a pushed
    /// explorer cannot change the root's filter.
    @State private var era: AtlasEra?

    init(model: AtlasModel, book: Int? = nil, chapter: Int? = nil, personID: String? = nil) {
        self.model = model
        scopedBook = book
        scopedChapter = chapter
        journeyPersonID = personID
    }

    /// A validated chapter scope, as Android's `chapterScope`.
    private var chapterScope: (order: Int, chapter: Int, name: String)? {
        guard let scopedBook, let scopedChapter, let book = Bible.book(order: scopedBook),
              scopedChapter >= 1, scopedChapter <= book.chapters
        else { return nil }
        return (scopedBook, scopedChapter, book.name)
    }

    private var scopeError: Bool {
        (scopedBook != nil || scopedChapter != nil) && chapterScope == nil
    }

    var body: some View {
        Group {
            if scopeError {
                GlassCard {
                    Text(AtlasPresentation.invalidChapterMessage)
                        .font(.system(size: 14))
                        .foregroundStyle(theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                .padding(Spacing.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Spacing.sm) {
                        searchField
                        modePicker
                        if chapterScope == nil && mode != .places {
                            eraNavigator
                        }

                        if model.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            browseBody
                        } else {
                            searchBody
                        }
                    }
                    .padding(.horizontal, Spacing.lg)
                    .padding(.bottom, Spacing.xl)
                }
            }
        }
        .background { MeshBackground() }
        .navigationTitle(atlasTitle)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { refresh(initial: true) }
        .onChange(of: mode) { _, next in
            // Android clears the era only when switching to Places; Timeline
            // and People share it.
            if next == .places { era = nil }
            refresh(initial: false)
        }
        .toolbar { toolbarContent }
    }

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(theme.textMuted)
            TextField("Search people, places and events", text: Binding(
                get: { model.searchQuery },
                set: { model.search($0) }
            ))
            .textInputAutocapitalization(.words)
            .autocorrectionDisabled()
            .accessibilityLabel("Search the Bible atlas")
            if !model.searchQuery.isEmpty {
                Button {
                    model.clearSearch()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(theme.textFaint)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, Spacing.md)
        .frame(minHeight: 44)
        .background(theme.surface, in: .capsule)
        .overlay { Capsule().strokeBorder(theme.border, lineWidth: 1) }
    }

    private var modePicker: some View {
        Picker("Atlas view", selection: $mode) {
            ForEach(AtlasExplorerMode.allCases) { item in
                Text(item.title).tag(item)
            }
        }
        .pickerStyle(.segmented)
        .frame(minHeight: 44)
        .accessibilityLabel("Atlas view")
    }

    private var eraNavigator: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                eraButton(nil, title: "All")
                // Static, like Android's ATLAS_ERAS: the chips render before
                // (and without) a timeline response.
                ForEach(AtlasPresentation.eraChips()) { chip in
                    eraButton(chip.era, title: chip.label)
                }
            }
            .padding(.vertical, Spacing.xs)
        }
        .frame(height: 52)
    }

    private func eraButton(_ value: AtlasEra?, title: String) -> some View {
        let active = era == value
        return Button {
            era = value == nil ? nil : (era == value ? nil : value)
            refresh(initial: false)
        } label: {
            Text(title)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(active ? theme.accent : theme.textMuted)
                .padding(.horizontal, Spacing.md)
                .frame(minHeight: 44)
                .background(active ? theme.accentSoft : theme.surface, in: .capsule)
                .overlay { Capsule().strokeBorder(active ? theme.accentBorder : theme.borderStrong, lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(value?.rawValue ?? "All eras")
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    // MARK: Browse

    @ViewBuilder private var browseBody: some View {
        switch mode {
        case .timeline:
            if let scope = chapterScope {
                chapterHeader(scope)
            }
            timelineBody
        case .people:
            entityDirectory(kind: .person, items: model.people, state: model.peopleState)
        case .places:
            entityDirectory(kind: .place, items: model.places, state: model.placesState)
        }
    }

    private var timelineIsCurrent: Bool { model.timelineKey == timelineKey }

    @ViewBuilder private var timelineBody: some View {
        if !timelineIsCurrent {
            loadingView("Opening the timeline…")
        } else {
            switch model.timelineState {
            case .idle, .loading:
                loadingView("Opening the timeline…")
            case .failed(let message):
                retryCard(message) { loadTimeline() }
            case .empty:
                emptyCard(AtlasPresentation.emptyTimelineMessage(
                    book: chapterScope?.name,
                    chapter: chapterScope?.chapter
                ))
                chronologyNote
            case .loaded:
                ForEach(model.timelineGroups) { group in
                    Text(group.era.rawValue.uppercased())
                        .font(.system(size: 11, weight: .bold))
                        .kerning(1.1)
                        .foregroundStyle(theme.accentDim)
                        .padding(.top, Spacing.md)
                    ForEach(Array(group.events.enumerated()), id: \.element.id) { index, event in
                        timelineRow(event, last: group.id == model.timelineGroups.last?.id && index == group.events.count - 1)
                    }
                }
                chronologyNote
            }
        }
    }

    private func timelineRow(_ event: AtlasEventView, last: Bool) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(spacing: Spacing.xs) {
                Text("✦")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(theme.accent)
                    .frame(width: 28, height: 28)
                    .background(theme.accentSoft, in: .circle)
                if !last { Rectangle().fill(theme.accentBorder).frame(width: 2).frame(maxHeight: .infinity) }
            }
            NavigationLink {
                AtlasEventDetailView(model: model, eventID: event.id, openReference: openReference)
            } label: {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(AtlasPresentation.eventDateLabel(event))
                        .font(.system(size: 11.5, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text(AtlasPresentation.eventDateProvenanceLabel(event))
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textGhost)
                    Text(event.title)
                        .font(.system(size: 15.5, weight: .bold))
                        .foregroundStyle(theme.text)
                    Text(event.summary)
                        .font(.system(size: 13))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(3)
                    Text(event.refs.joined(separator: " · "))
                        .font(.system(size: 11.5))
                        .foregroundStyle(theme.textGhost)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Spacing.md)
                .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
                .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(event.title), \(AtlasPresentation.eventDateLabel(event))")
        }
    }

    private var chronologyNote: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(AtlasPresentation.chronologyLabel).atlasSectionLabel(theme)
            Text(AtlasPresentation.ussherNote)
                .font(.system(size: 11.5))
                .foregroundStyle(theme.textGhost)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func entityDirectory(kind: AtlasEntityKind, items: [AtlasEntitySummary], state: AtlasLoadState) -> some View {
        let current = (kind == .person ? model.peopleEra : model.placesEra) == directoryEra(for: kind)
        if !current {
            loadingView(kind == .person ? "Opening people…" : "Opening places…")
        } else {
            switch state {
            case .idle, .loading: loadingView(kind == .person ? "Opening people…" : "Opening places…")
            case .failed(let message): retryCard(message) { model.reloadEntities(kind: kind) }
            case .empty: emptyCard(AtlasPresentation.emptyDirectoryMessage(kind))
            case .loaded:
                ForEach(items) { entity in
                    NavigationLink { AtlasEntityDetailView(model: model, entityID: entity.id, openReference: openReference) } label: {
                        entityRow(entity)
                    }
                    .buttonStyle(.plain)
                }
                // Directories load every page, as Android's do; this only
                // appears if a later page failed to arrive.
                if (kind == .person ? model.peopleNextCursor : model.placesNextCursor) != nil {
                    Button("Load more") { model.loadMoreEntities(kind: kind) }
                        .buttonStyle(AccentButtonStyle())
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
        }
    }

    private func entityRow(_ entity: AtlasEntitySummary) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(entity.name)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(theme.text)
                if let disambiguator = entity.disambiguator {
                    Text(disambiguator)
                        .font(.system(size: 12))
                        .foregroundStyle(theme.accent)
                }
                Text(entity.description)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textMuted)
                    .lineLimit(2)
                Text(AtlasPresentation.entityRowMeta(entity))
                    .font(.system(size: 11.5))
                    .foregroundStyle(theme.textGhost)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(entity.name)\(entity.disambiguator.map { ", \($0)" } ?? ""), \(entity.kind == .person ? "person" : "place")"
        )
    }

    /// "Who's in this chapter": the chapter's people and places from the
    /// atlas's own references (`/api/bible/atlas?book=&chapter=`), not only
    /// the people of its events.
    @ViewBuilder private func chapterHeader(_ scope: (order: Int, chapter: Int, name: String)) -> some View {
        Text("WHO'S IN THIS CHAPTER").atlasSectionLabel(theme)
        let current = model.chapterBook == scope.order && model.chapterNumber == scope.chapter
        switch current ? model.chapterState : .loading {
        case .idle, .loading:
            ProgressView().frame(maxWidth: .infinity, minHeight: 44)
        case .failed(let message):
            retryCard(message) { model.loadChapter(book: scope.order, chapter: scope.chapter) }
        case .empty:
            Text(AtlasPresentation.emptyChapterMessage(book: scope.name, chapter: scope.chapter))
                .font(.system(size: 13))
                .foregroundStyle(theme.textMuted)
        case .loaded:
            FlowChips(items: model.chapterView?.entities ?? []) { entity in
                NavigationLink {
                    AtlasEntityDetailView(model: model, entityID: entity.id, openReference: openReference)
                } label: {
                    AtlasEntityChip(entity: entity)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Search

    @ViewBuilder private var searchBody: some View {
        switch model.searchState {
        case .idle:
            loadingView("Searching the atlas…")
        case .loading where model.searchResults.isEmpty:
            // A refining query keeps the previous results visible.
            loadingView("Searching the atlas…")
        case .failed(let message): retryCard(message) { model.search(model.searchQuery) }
        default:
            Text(AtlasPresentation.searchSummary(shown: model.searchResults.count, counts: model.searchCounts))
                .font(.system(size: 12))
                .foregroundStyle(theme.textFaint)
            ForEach([AtlasHitKind.person, .place, .event], id: \.self) { kind in
                let hits = model.searchResults.filter { $0.kind == kind }
                if !hits.isEmpty {
                    Text("\(AtlasPresentation.hitSectionLabel(kind)) (\(count(for: kind)))")
                        .atlasSectionLabel(theme)
                    ForEach(hits) { hit in
                        searchRow(hit)
                    }
                }
            }
        }
    }

    private func searchRow(_ hit: AtlasSearchHit) -> some View {
        Group {
            if hit.kind == .event {
                NavigationLink { AtlasEventDetailView(model: model, eventID: hit.id, openReference: openReference) } label: { searchRowLabel(hit) }
            } else {
                NavigationLink { AtlasEntityDetailView(model: model, entityID: hit.id, openReference: openReference) } label: { searchRowLabel(hit) }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            "\(hit.name)\(hit.disambiguator.map { ", \($0)" } ?? ""), \(AtlasPresentation.hitKindLabel(hit.kind))"
        )
    }

    private func searchRowLabel(_ hit: AtlasSearchHit) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(hit.name).font(.system(size: 15, weight: .bold)).foregroundStyle(theme.text)
                if let disambiguator = hit.disambiguator { Text(disambiguator).font(.system(size: 12)).foregroundStyle(theme.accent) }
                Text(hit.description).font(.system(size: 13)).foregroundStyle(theme.textMuted).lineLimit(2)
                Text(AtlasPresentation.searchRowMeta(hit)).font(.system(size: 11.5)).foregroundStyle(theme.textGhost)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
    }

    private func count(for kind: AtlasHitKind) -> Int {
        switch kind {
        case .person: model.searchCounts.person
        case .place: model.searchCounts.place
        case .event: model.searchCounts.event
        }
    }

    @ToolbarContentBuilder private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { model.clearSearch() } label: { Image(systemName: "line.3.horizontal.decrease.circle") }
                .accessibilityLabel("Reset atlas search")
        }
    }

    // MARK: Loading

    private var timelineKey: AtlasTimelineKey {
        AtlasTimelineKey(
            era: era,
            book: chapterScope?.order,
            chapter: chapterScope?.chapter,
            personID: journeyPersonID
        )
    }

    /// People keep the era; places have none (Android passes it for people only).
    private func directoryEra(for kind: AtlasEntityKind) -> AtlasEra? {
        kind == .person ? era : nil
    }

    /// Bring the shared model back to what this screen shows. Runs on every
    /// appear, so returning from a pushed journey or chapter explorer reloads
    /// this screen's own rail instead of showing the other one's.
    private func refresh(initial: Bool) {
        guard !scopeError else { return }
        if initial, journeyPersonID != nil { model.clearSearch() }
        if let scope = chapterScope,
           model.chapterBook != scope.order || model.chapterNumber != scope.chapter || model.chapterState == .idle {
            model.loadChapter(book: scope.order, chapter: scope.chapter)
        }
        switch mode {
        case .timeline:
            if model.timelineKey != timelineKey || model.timelineState == .idle { loadTimeline() }
        case .people, .places:
            let kind: AtlasEntityKind = mode == .people ? .person : .place
            let loadedEra = kind == .person ? model.peopleEra : model.placesEra
            let state = kind == .person ? model.peopleState : model.placesState
            if loadedEra != directoryEra(for: kind) || state == .idle || !initial {
                model.loadEntities(kind: kind, era: directoryEra(for: kind), limit: 100, allPages: true)
            }
        }
    }

    private func loadTimeline() {
        model.loadTimeline(
            era: era,
            book: chapterScope?.order,
            chapter: chapterScope?.chapter,
            personID: journeyPersonID
        )
    }

    /// Android's title: the chapter, the directory, or the explorer name.
    private var atlasTitle: String {
        if let chapterScope { return "\(chapterScope.name) \(chapterScope.chapter)" }
        switch mode {
        case .people: return "People"
        case .places: return "Places"
        case .timeline: return AtlasPresentation.explorerTitle
        }
    }

    private func openReference(_ raw: String) -> AnyView {
        AtlasReferenceChip.make(raw, theme: theme)
    }

    private func loadingView(_ title: String) -> some View {
        VStack(spacing: Spacing.md) {
            ProgressView()
            Text(title).font(.system(size: 13)).foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.xxl)
    }

    private func emptyCard(_ message: String) -> some View {
        AtlasMessageCard(message: message)
    }

    private func retryCard(_ message: String, retry: @escaping () -> Void) -> some View {
        AtlasMessageCard(message: message, retry: retry)
    }
}

private enum AtlasExplorerMode: String, CaseIterable, Identifiable {
    case timeline, people, places
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

// MARK: - Shared pieces

/// A reference chip that opens the reader at that verse, "{ref} ›" as on
/// Android. An unparseable reference is shown but opens nothing.
private enum AtlasReferenceChip {
    @MainActor static func make(_ raw: String, theme: SureWordColors) -> AnyView {
        let label = AtlasPresentation.referenceChipLabel(raw)
        guard let reference = Bible.resolveReference(raw) else {
            return AnyView(Text(label).foregroundStyle(theme.textGhost).padding(.horizontal, Spacing.md).frame(minHeight: 44))
        }
        return AnyView(
            NavigationLink {
                ChapterReaderView(order: reference.order, chapter: reference.chapter, verse: reference.verse)
            } label: {
                Text(label)
                    .foregroundStyle(theme.accent)
                    .padding(.horizontal, Spacing.md)
                    .frame(minHeight: 44)
                    .background(theme.accentSoft, in: .capsule)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Read \(raw)")
        )
    }
}

private struct AtlasMessageCard: View {
    @Environment(\.theme) private var theme
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        GlassCard {
            VStack(spacing: Spacing.md) {
                Text(message)
                    .font(.system(size: 14))
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                if let retry {
                    Button("Try again", action: retry).buttonStyle(AccentButtonStyle())
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// A person or place chip: the name, and the disambiguator under it.
private struct AtlasEntityChip: View {
    @Environment(\.theme) private var theme
    let entity: AtlasEntityRef

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(entity.name)
                .font(.system(size: 14))
                .foregroundStyle(theme.textSecondary)
            if let disambiguator = entity.disambiguator {
                Text(disambiguator)
                    .font(.system(size: 11))
                    .foregroundStyle(theme.textMuted)
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.xs)
        .frame(minHeight: 44)
        .background(theme.surface, in: .capsule)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(entity.name)\(entity.disambiguator.map { ", \($0)" } ?? ""), \(entity.kind == .person ? "person" : "place")"
        )
    }
}

private struct AtlasDetailMessage: View {
    @Environment(\.theme) private var theme
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        AtlasMessageCard(message: message, retry: retry)
            .padding(Spacing.lg)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Event

private struct AtlasEventDetailView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    let model: AtlasModel
    let eventID: String
    let openReference: (String) -> AnyView

    /// The last copy of this event the model delivered, so returning to this
    /// screen after another detail loaded never flashes a spinner.
    @State private var cached: AtlasEventView?

    private var event: AtlasEventView? {
        if let selected = model.selectedEvent, selected.id == eventID { return selected }
        return cached
    }

    private var isCurrentRequest: Bool { model.selectedEventID == eventID }

    var body: some View {
        Group {
            if let event {
                content(event)
            } else if isCurrentRequest, model.detailNotFound {
                AtlasDetailMessage(message: AtlasPresentation.eventNotFoundMessage)
            } else if isCurrentRequest, case .failed(let message) = model.detailState {
                AtlasDetailMessage(message: message) { model.loadEvent(eventID) }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background { MeshBackground() }
        .navigationTitle(event?.title ?? "Event")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { model.loadEvent(eventID) }
        .onChange(of: model.selectedEvent) { _, next in
            if let next, next.id == eventID { cached = next }
        }
    }

    private func content(_ event: AtlasEventView) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(event.title).font(.custom(FontFamily.brand, size: 30)).foregroundStyle(theme.text)
                Text(AtlasPresentation.eventCaption(event)).font(.system(size: 13)).foregroundStyle(theme.textMuted)
                Text(AtlasPresentation.eventDateProvenanceLabel(event)).font(.system(size: 11.5)).foregroundStyle(theme.textGhost)
                GlassCard {
                    Text(event.summary)
                        .font(.system(size: 15))
                        .foregroundStyle(theme.textSecondary)
                        .lineSpacing(4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Text("IN SCRIPTURE").atlasSectionLabel(theme)
                FlowLayout(items: event.refs, content: openReference)
                if !event.people.isEmpty || !event.places.isEmpty {
                    Text("WHO AND WHERE").atlasSectionLabel(theme)
                    FlowChips(items: event.people + event.places) { entity in
                        NavigationLink {
                            AtlasEntityDetailView(model: model, entityID: entity.id, openReference: openReference)
                        } label: {
                            AtlasEntityChip(entity: entity)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Button {
                    app.chat.input = AtlasPresentation.askPrompt(for: event)
                    NotificationCenter.default.post(name: .openChatWithAttachment, object: nil)
                } label: {
                    Text("✦ Ask about this").frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(AccentButtonStyle())
                .padding(.top, Spacing.md)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xl)
        }
    }
}

// MARK: - Person or place

private struct AtlasEntityDetailView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    let model: AtlasModel
    let entityID: String
    let openReference: (String) -> AnyView

    @State private var cached: AtlasEntityView?

    private var entity: AtlasEntityView? {
        if let selected = model.selectedEntity, selected.id == entityID { return selected }
        return cached
    }

    private var isCurrentRequest: Bool { model.selectedEntityID == entityID }

    var body: some View {
        Group {
            if let entity {
                content(entity)
            } else if isCurrentRequest, model.detailNotFound {
                AtlasDetailMessage(message: AtlasPresentation.entityNotFoundMessage)
            } else if isCurrentRequest, case .failed(let message) = model.detailState {
                AtlasDetailMessage(message: message) { model.loadEntity(entityID) }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background { MeshBackground() }
        .navigationTitle(entity?.name ?? (isCurrentRequest && model.detailNotFound ? "Not found" : ""))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { model.loadEntity(entityID) }
        .onChange(of: model.selectedEntity) { _, next in
            if let next, next.id == entityID { cached = next }
        }
    }

    private func content(_ entity: AtlasEntityView) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(entity.name).font(.custom(FontFamily.brand, size: 30)).foregroundStyle(theme.text)
                if let disambiguator = entity.disambiguator {
                    Text(disambiguator).font(.system(size: 13)).foregroundStyle(theme.accent)
                }
                Text(AtlasPresentation.entitySubtitle(entity)).font(.system(size: 13)).foregroundStyle(theme.textMuted)
                let alsoCalled = AtlasPresentation.alsoCalledLine(entity)
                if !alsoCalled.isEmpty {
                    Text(alsoCalled).font(.system(size: 13)).italic().foregroundStyle(theme.textSecondary)
                }
                GlassCard {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(entity.description)
                            .font(.system(size: 15))
                            .foregroundStyle(theme.textSecondary)
                            .lineSpacing(4)
                        Text(AtlasPresentation.entityCounts(entity))
                            .font(.system(size: 11.5))
                            .foregroundStyle(theme.textGhost)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                Text("IN SCRIPTURE").atlasSectionLabel(theme)
                FlowLayout(items: entity.refs, content: openReference)

                connections(entity)
                timeline(entity)

                if entity.kind == .person {
                    NavigationLink { AtlasExplorerView(model: model, personID: entityID) } label: {
                        Text("View journey").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(AccentButtonStyle())
                    .padding(.top, Spacing.md)
                    NavigationLink { AtlasFamilyView(model: model, entity: entity, openReference: openReference) } label: {
                        Text("Immediate family").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(AccentButtonStyle())
                    NavigationLink { AtlasTraceView(model: model, entity: entity, openReference: openReference) } label: {
                        Text("Trace connection").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(AccentButtonStyle())
                }
                Button {
                    app.chat.input = AtlasPresentation.askPrompt(for: entity)
                    NotificationCenter.default.post(name: .openChatWithAttachment, object: nil)
                } label: {
                    Text("✦ Ask about this").frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(AccentButtonStyle())
                .padding(.top, Spacing.md)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.xl)
        }
    }

    /// Android lists the typed relations under CONNECTED TO and falls back to
    /// the legacy `related` ids only when there are none. iOS keeps any
    /// legacy ids the typed graph does not cover in a section of their own.
    @ViewBuilder private func connections(_ entity: AtlasEntityView) -> some View {
        let typedConnectionIDs = Set(entity.relationDetails.map(\.entity.id))
        let legacyConnections = entity.related.filter { !typedConnectionIDs.contains($0.id) }
        if !entity.relationDetails.isEmpty {
            Text("CONNECTED TO").atlasSectionLabel(theme)
            ForEach(entity.relationDetails, id: \.relation.id) { entry in
                AtlasRelationRow(model: model, entry: entry, openReference: openReference)
            }
            if !legacyConnections.isEmpty {
                Text("OTHER RECORDED CONNECTIONS").atlasSectionLabel(theme)
                legacyChips(legacyConnections)
            }
        } else if !legacyConnections.isEmpty {
            Text("CONNECTED TO").atlasSectionLabel(theme)
            legacyChips(legacyConnections)
        }
    }

    private func legacyChips(_ connections: [AtlasEntityRef]) -> some View {
        FlowChips(items: connections) { connection in
            NavigationLink {
                AtlasEntityDetailView(model: model, entityID: connection.id, openReference: openReference)
            } label: {
                HStack(spacing: Spacing.xs) {
                    Image(systemName: connection.kind == .person ? "person" : "mappin.and.ellipse")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textMuted)
                    AtlasEntityChip(entity: connection)
                }
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder private func timeline(_ entity: AtlasEntityView) -> some View {
        if !entity.events.isEmpty {
            Text("ON THE TIMELINE").atlasSectionLabel(theme)
            ForEach(entity.events.prefix(5)) { event in
                NavigationLink {
                    AtlasEventDetailView(model: model, eventID: event.id, openReference: openReference)
                } label: {
                    eventRow(event)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open event \(event.title)")
            }
            if entity.events.count > 5 {
                NavigationLink { AtlasExplorerView(model: model, personID: entityID) } label: {
                    Text("View all \(entity.events.count) events ›").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(theme.accent)
            }
        }
    }

    private func eventRow(_ event: AtlasEntityEventSummary) -> some View {
        HStack {
            Text(event.yearLabel)
                .font(.system(size: 11.5, weight: .bold))
                .foregroundStyle(theme.accent)
                .frame(width: 92, alignment: .leading)
            VStack(alignment: .leading) {
                Text(event.title).foregroundStyle(theme.textSecondary)
                Text(event.era.rawValue).font(.system(size: 11.5)).foregroundStyle(theme.textGhost)
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(theme.textFaint)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
    }
}

/// One typed relation: "Sibling Aaron", the disambiguator, how certain the
/// link is ("Scripture states" / "Inferred" / "Disputed"), and its verses.
private struct AtlasRelationRow: View {
    @Environment(\.theme) private var theme
    let model: AtlasModel
    let entry: AtlasNeighborhoodEntry
    let openReference: (String) -> AnyView

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            NavigationLink {
                AtlasEntityDetailView(model: model, entityID: entry.entity.id, openReference: openReference)
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(AtlasPresentation.relationRowTitle(entry))
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(theme.text)
                        if let disambiguator = entry.entity.disambiguator {
                            Text(disambiguator).font(.system(size: 11.5)).foregroundStyle(theme.textMuted)
                        }
                        Text(AtlasPresentation.relationCertaintyLabel(entry.relation.certainty))
                            .font(.system(size: 11.5))
                            .foregroundStyle(theme.textGhost)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(theme.textFaint)
                }
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                "\(AtlasPresentation.relationRowTitle(entry))\(entry.entity.disambiguator.map { ", \($0)" } ?? "")"
            )
            if !entry.relation.refs.isEmpty {
                FlowLayout(items: entry.relation.refs, content: openReference)
            }
        }
        .padding(Spacing.md)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
    }
}

// MARK: - Immediate family

/// Immediate family stays linear: one row per parent, spouse or sibling,
/// each with its certainty and verses, as Android's family screen.
private struct AtlasFamilyView: View {
    @Environment(\.theme) private var theme
    let model: AtlasModel
    let entity: AtlasEntityView
    let openReference: (String) -> AnyView

    var body: some View {
        Group {
            if entity.kind != .person {
                AtlasDetailMessage(message: AtlasPresentation.familyUnavailableMessage)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(entity.name)
                            .font(.custom(FontFamily.brand, size: 30))
                            .foregroundStyle(theme.text)
                        if let disambiguator = entity.disambiguator {
                            Text(disambiguator).font(.system(size: 13)).foregroundStyle(theme.accent)
                        }
                        Text(AtlasPresentation.familySubtitle)
                            .font(.system(size: 13))
                            .foregroundStyle(theme.textMuted)

                        let family = AtlasPresentation.immediateFamily(entity.relationDetails)
                        if family.isEmpty {
                            AtlasMessageCard(message: AtlasPresentation.emptyFamilyMessage(entity.name))
                                .padding(.vertical, Spacing.lg)
                        } else {
                            ForEach(family, id: \.relation.id) { entry in
                                AtlasRelationRow(model: model, entry: entry, openReference: openReference)
                            }
                        }
                    }
                    .padding(.horizontal, Spacing.lg)
                    .padding(.bottom, Spacing.xl)
                }
            }
        }
        .background { MeshBackground() }
        .navigationTitle("Immediate family")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Trace connection

private struct AtlasTraceView: View {
    @Environment(\.theme) private var theme
    let model: AtlasModel
    let entity: AtlasEntityView
    let openReference: (String) -> AnyView

    @State private var query = ""
    @State private var targetID: String?
    @State private var started = false

    /// Only a path from this person to the chosen target is ever shown.
    private var path: AtlasPersonConnectionPath? {
        guard let targetID, let path = model.connectionPath,
              path.ids.first == entity.id, path.ids.last == targetID
        else { return nil }
        return path
    }

    var body: some View {
        Group {
            if entity.kind != .person {
                AtlasDetailMessage(message: AtlasPresentation.traceUnavailableMessage)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(AtlasPresentation.traceHeading(entity.name))
                            .font(.custom(FontFamily.brand, size: 30))
                            .foregroundStyle(theme.text)
                        if let disambiguator = entity.disambiguator {
                            Text(disambiguator).font(.system(size: 13)).foregroundStyle(theme.accent)
                        }
                        Text(AtlasPresentation.traceSubtitle)
                            .font(.system(size: 13))
                            .foregroundStyle(theme.textMuted)
                        TextField("Search a person", text: Binding(
                            get: { query },
                            set: { next in
                                query = next
                                targetID = nil
                                model.searchTracePeople(next, excluding: entity.id)
                            }
                        ))
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .padding(.horizontal, Spacing.md)
                        .frame(minHeight: 48)
                        .background(theme.surface, in: .capsule)
                        .overlay { Capsule().strokeBorder(theme.border, lineWidth: 1) }
                        .accessibilityLabel("Search a person to trace")

                        if targetID == nil, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            candidates
                        }
                        if targetID != nil { outcome }
                    }
                    .padding(.horizontal, Spacing.lg)
                    .padding(.bottom, Spacing.xl)
                }
            }
        }
        .background { MeshBackground() }
        .navigationTitle("Trace connection")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: resume)
    }

    @ViewBuilder private var candidates: some View {
        switch model.traceSearchState {
        case .idle, .loading:
            ProgressView().frame(maxWidth: .infinity, minHeight: 48)
        case .failed(let message):
            AtlasMessageCard(message: message) { model.searchTracePeople(query, excluding: entity.id) }
        case .empty, .loaded:
            ForEach(model.traceResults) { hit in
                Button {
                    targetID = hit.id
                    model.traceConnection(from: entity.id, to: hit.id)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(hit.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(theme.text)
                            if let disambiguator = hit.disambiguator {
                                Text(disambiguator).font(.system(size: 11.5)).foregroundStyle(theme.accent)
                            }
                            Text(hit.era?.rawValue ?? "Person")
                                .font(.system(size: 11.5))
                                .foregroundStyle(theme.textGhost)
                                .lineLimit(1)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(theme.textFaint)
                    }
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Trace to \(hit.name)\(hit.disambiguator.map { ", \($0)" } ?? "")")
            }
        }
    }

    @ViewBuilder private var outcome: some View {
        if let path {
            Text("SHORTEST CITED PATH").atlasSectionLabel(theme)
            ForEach(Array(path.entities.enumerated()), id: \.element.id) { index, step in
                NavigationLink {
                    AtlasEntityDetailView(model: model, entityID: step.id, openReference: openReference)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(step.name).foregroundStyle(theme.accent)
                        if let disambiguator = step.disambiguator {
                            Text(disambiguator).font(.system(size: 11.5)).foregroundStyle(theme.textMuted)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Spacing.md)
                    .frame(minHeight: 48)
                    .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(step.name)\(step.disambiguator.map { ", \($0)" } ?? "")")
                if index < path.relations.count {
                    let relation = path.relations[index]
                    Text(AtlasRelationLabels.label(for: relation, perspectiveID: step.id))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                    Text(AtlasPresentation.relationCertaintyLabel(relation.certainty))
                        .font(.system(size: 11.5))
                        .foregroundStyle(theme.textGhost)
                    FlowLayout(items: relation.refs, content: openReference)
                }
            }
        } else if model.connectionNotFound {
            AtlasMessageCard(message: AtlasPresentation.traceNoPathMessage)
        } else if case .failed(let message) = model.connectionState {
            AtlasMessageCard(message: message) {
                if let targetID { model.traceConnection(from: entity.id, to: targetID) }
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, minHeight: 48)
        }
    }

    /// First appearance starts clean; a return (from a person on the path)
    /// re-asks for whatever another trace screen replaced in the model.
    private func resume() {
        guard started else {
            started = true
            model.resetTrace()
            return
        }
        if let targetID {
            if path == nil && !model.connectionState.isLoading {
                model.traceConnection(from: entity.id, to: targetID)
            }
        } else if model.traceQuery != query {
            model.searchTracePeople(query, excluding: entity.id, delay: .zero)
        }
    }
}

// MARK: - Layout

private struct FlowLayout<Content: View>: View {
    let items: [String]
    let content: (String) -> Content
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)], alignment: .leading, spacing: Spacing.sm) {
            ForEach(items, id: \.self) { item in content(item) }
        }
    }
}

private struct FlowChips<Content: View>: View {
    let items: [AtlasEntityRef]
    let content: (AtlasEntityRef) -> Content
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)], alignment: .leading, spacing: Spacing.sm) {
            ForEach(items) { item in content(item) }
        }
    }
}

private extension View {
    func atlasSectionLabel(_ theme: SureWordColors) -> some View {
        font(.system(size: 11.5, weight: .bold)).kerning(1.1).foregroundStyle(theme.accentDim).padding(.top, Spacing.lg)
    }
}
