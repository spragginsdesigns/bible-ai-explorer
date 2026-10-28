import SwiftUI

/// Desktop Timeline / People / Places explorer. The data and request
/// cancellation live in AtlasModel; this view only composes the native list
/// and detail panes around that shared state. Wording, dates and prompts come
/// from `AtlasPresentation`, the same port of Android's `atlasView.ts` iOS uses.
struct AtlasExplorerPane: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Bindable var model: AtlasModel

    let onOpenReference: (String) -> Void
    let onDismiss: () -> Void
    // `var`, not `let`: a `let` with a default value is left out of the
    // memberwise initializer, which is what BibleSection uses to pass these.
    var scopedBook: Int? = nil
    var scopedChapter: Int? = nil
    /// The view it opens on: Study's Bible timeline, People of the Bible and
    /// Places & atlas rows each open their own, as Android's `?mode=` does.
    var initialMode: AtlasExplorerMode = .timeline
    /// Where the back button returns: the Bible, or Study when opened there.
    var backTitle: String = "Bible"

    @State private var mode: AtlasExplorerMode = .timeline
    @State private var expandedRelationID: String?
    @State private var traceExpanded = false
    @State private var traceQuery = ""
    @State private var traceTargetID: String?
    /// The person the rail is filtered to, by name, while a journey shows.
    @State private var journeyName: String?
    @State private var history = AtlasDetailHistory()
    /// The scope this pane last started for, so a return to the same pane
    /// keeps the reader's mode and filters.
    @State private var startedKey: String?

    private var scopeKey: String { "\(scopedBook ?? 0):\(scopedChapter ?? 0)" }

    /// A validated chapter scope, as Android's `chapterScope`.
    private var chapterScope: (name: String, chapter: Int)? {
        guard let scopedBook, let scopedChapter, let book = Bible.book(order: scopedBook),
              scopedChapter >= 1, scopedChapter <= book.chapters
        else { return nil }
        return (book.name, scopedChapter)
    }

    private var isSearching: Bool {
        !model.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        HStack(spacing: 0) {
            listPane
                .frame(minWidth: 360, idealWidth: 440, maxWidth: 520)

            Divider().overlay(theme.border)

            detailPane
                .frame(minWidth: 340, idealWidth: 410, maxWidth: 480)
        }
        .task(id: scopeKey) { start() }
        .onChange(of: model.selectedEntityID) { _, _ in
            expandedRelationID = nil
            traceExpanded = false
            traceQuery = ""
            traceTargetID = nil
        }
        // Picking an entry is Android pushing its page; the trace is its own
        // page there too. Family stays inline on the entry's page here.
        .onChange(of: model.selectedEntityID) { _, id in
            if id != nil { Analytics.shared.screen(AnalyticsScreen.atlas) }
        }
        .onChange(of: model.selectedEventID) { _, id in
            if id != nil { Analytics.shared.screen(AnalyticsScreen.atlasEvent) }
        }
        .onChange(of: traceExpanded) { _, expanded in
            if expanded {
                Analytics.shared.screen(AnalyticsScreen.atlasTrace)
            } else {
                Analytics.shared.screenReturned(from: AnalyticsScreen.atlasTrace, to: AnalyticsScreen.atlas)
            }
        }
    }

    private var listPane: some View {
        VStack(spacing: 0) {
            header
            searchField

            if mode != .places && chapterScope == nil && !isSearching {
                eraScroller
            }

            if isSearching {
                searchContent
            } else {
                modeContent
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var header: some View {
        HStack(spacing: Spacing.md) {
            Button(action: onDismiss) {
                Label(backTitle, systemImage: "chevron.left")
                    .appFont(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .buttonStyle(SubtleButtonStyle())
            .help("Back to \(backTitle)")

            Text(AtlasExplorerMode.title(mode: mode, chapterScope: chapterScope))
                .appFont(.custom(FontFamily.brand, size: 24))
                .foregroundStyle(theme.text)
                .lineLimit(1)

            Spacer()
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.lg)
    }

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .appFont(.system(size: 12))
                .foregroundStyle(theme.textGhost)

            TextField(
                "Search people, places and events",
                text: Binding(
                    get: { model.searchQuery },
                    set: { model.search($0) }
                )
            )
            .textFieldStyle(.plain)
            .appFont(.system(size: 13))
            .foregroundStyle(theme.text)
            .accessibilityLabel("Search the Bible atlas")

            if !model.searchQuery.isEmpty {
                Button {
                    model.clearSearch()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .appFont(.system(size: 12))
                        .foregroundStyle(theme.textGhost)
                }
                .buttonStyle(.plain)
                .help("Clear atlas search")
                .accessibilityLabel("Clear atlas search")
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.border, lineWidth: 1)
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.bottom, Spacing.sm)
    }

    private var eraScroller: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.xs) {
                eraButton(nil, title: "All")
                // Static, like Android's ATLAS_ERAS: the chips render before
                // (and without) a timeline response.
                ForEach(AtlasPresentation.eraChips()) { chip in
                    eraButton(chip.era, title: chip.label)
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.xs)
        }
    }

    private func eraButton(_ era: AtlasEra?, title: String) -> some View {
        let active = model.selectedEra == era
        return Button {
            // Android: tapping the active era clears it back to All.
            let next = era == nil || active ? nil : era
            switch mode {
            case .timeline:
                model.selectedEra = next
                model.loadTimeline(
                    era: next,
                    book: scopedBook,
                    chapter: scopedChapter,
                    personID: model.journeyPersonID
                )
            case .people:
                model.selectedEra = next
                model.loadEntities(kind: .person, era: next, limit: 100, allPages: true)
            case .places:
                // Places have no era dimension.
                break
            }
        } label: {
            Text(title)
                .appFont(.system(size: 11, weight: .semibold))
                .foregroundStyle(active ? theme.accent : theme.textMuted)
                .padding(.horizontal, Spacing.sm)
                .padding(.vertical, 6)
                .background(active ? theme.accentSoft : theme.surface, in: .capsule)
                .overlay {
                    Capsule().strokeBorder(active ? theme.accentBorder : theme.border, lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
        .help(era?.rawValue ?? "All eras")
        .accessibilityLabel(era?.rawValue ?? "All eras")
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private var modePicker: some View {
        // An explicit closure, not `set: setMode`: partially applying the
        // @MainActor method here makes the Swift 6.2 compiler (Xcode 26.6)
        // crash in IRGen on the reabstraction thunk.
        Picker("Atlas view", selection: Binding(get: { mode }, set: { next in
            if next != mode { setMode(next) }
        })) {
            ForEach(AtlasExplorerMode.allCases) { item in
                Text(item.title).tag(item)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.sm)
    }

    private var modeContent: some View {
        VStack(spacing: 0) {
            modePicker
            ScrollView {
                switch mode {
                case .timeline:
                    timelineContent
                case .people:
                    entityList(kind: .person)
                case .places:
                    entityList(kind: .place)
                }
            }
        }
    }

    private var timelineContent: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            if let scope = chapterScope {
                chapterHeader(scope)
            }
            if model.journeyPersonID != nil, let journeyName {
                journeyBar(journeyName)
            }
            switch model.timelineState {
            case .idle, .loading:
                atlasLoading("Opening the timeline…")
            case .failed(let message):
                atlasError(message) {
                    model.loadTimeline(
                        era: model.selectedEra,
                        book: scopedBook,
                        chapter: scopedChapter,
                        personID: model.journeyPersonID
                    )
                }
            case .empty:
                atlasEmpty(AtlasPresentation.emptyTimelineMessage(
                    book: chapterScope?.name,
                    chapter: chapterScope?.chapter
                ))
                chronologyNote
            case .loaded:
                ForEach(model.timelineGroups) { group in
                    Text(group.era.rawValue.uppercased())
                        .appFont(.system(size: 10, weight: .bold))
                        .kerning(1.1)
                        .foregroundStyle(theme.textMuted)
                        .padding(.top, Spacing.md)
                        .padding(.bottom, Spacing.sm)

                    ForEach(Array(group.events.enumerated()), id: \.element.id) { index, event in
                        eventRow(event, isLast: index == group.events.count - 1)
                    }
                }
                chronologyNote
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.bottom, Spacing.xl)
    }

    /// "Who's in this chapter": the chapter's people and places from the
    /// atlas's own references, not only the people of its events.
    @ViewBuilder private func chapterHeader(_ scope: (name: String, chapter: Int)) -> some View {
        Text("WHO'S IN THIS CHAPTER")
            .appFont(.system(size: 10, weight: .bold))
            .kerning(1.1)
            .foregroundStyle(theme.accent)
            .padding(.bottom, Spacing.sm)
        let current = model.chapterBook == scopedBook && model.chapterNumber == scopedChapter
        switch current ? model.chapterState : .loading {
        case .idle, .loading:
            ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 36)
        case .failed(let message):
            atlasError(message) {
                if let scopedBook, let scopedChapter { model.loadChapter(book: scopedBook, chapter: scopedChapter) }
            }
        case .empty:
            Text(AtlasPresentation.emptyChapterMessage(book: scope.name, chapter: scope.chapter))
                .appFont(.system(size: 12))
                .foregroundStyle(theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, Spacing.md)
        case .loaded:
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)],
                alignment: .leading,
                spacing: Spacing.xs
            ) {
                ForEach(model.chapterView?.entities ?? []) { entity in
                    Button {
                        openDetail(.entity(entity.id), fromDetail: false)
                    } label: {
                        entityChip(entity)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, Spacing.md)
        }
    }

    /// The rail is one person's journey: say whose, and offer the way out.
    private func journeyBar(_ name: String) -> some View {
        HStack(spacing: Spacing.sm) {
            Text("Journey · \(name)")
                .appFont(.system(size: 11, weight: .semibold))
                .foregroundStyle(theme.accent)
            Spacer(minLength: Spacing.sm)
            Button {
                clearJourney()
            } label: {
                Label("Show all events", systemImage: "xmark.circle.fill")
                    .appFont(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textMuted)
            }
            .buttonStyle(.plain)
            .help("Show the whole timeline")
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(theme.accentSoft, in: .capsule)
        .overlay { Capsule().strokeBorder(theme.accentBorder, lineWidth: 1) }
        .padding(.bottom, Spacing.sm)
    }

    private var chronologyNote: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(AtlasPresentation.chronologyLabel)
                .appFont(.system(size: 10, weight: .bold))
                .kerning(1.1)
                .foregroundStyle(theme.textMuted)
            Text(AtlasPresentation.ussherNote)
                .appFont(.system(size: 10))
                .foregroundStyle(theme.textGhost)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, Spacing.lg)
        .accessibilityElement(children: .combine)
    }

    private func eventRow(_ event: AtlasEventView, isLast: Bool) -> some View {
        Button {
            openDetail(.event(event.id), fromDetail: false)
        } label: {
            HStack(alignment: .top, spacing: Spacing.md) {
                VStack(spacing: 0) {
                    Text("✦")
                        .appFont(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.accent)
                        .frame(width: 26, height: 26)
                        .background(theme.accentSoft, in: .circle)
                        .overlay { Circle().strokeBorder(theme.accentBorder, lineWidth: 1) }
                    if !isLast {
                        Rectangle()
                            .fill(theme.accentBorder)
                            .frame(width: 1)
                            .frame(minHeight: 52, maxHeight: .infinity)
                    }
                }

                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(AtlasPresentation.eventDateLabel(event))
                        .appFont(.system(size: 10, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text(AtlasPresentation.eventDateProvenanceLabel(event))
                        .appFont(.system(size: 10))
                        .foregroundStyle(theme.textGhost)
                    Text(event.title)
                        .appFont(.system(size: 14, weight: .semibold))
                        .foregroundStyle(theme.text)
                        .multilineTextAlignment(.leading)
                    Text(event.summary)
                        .appFont(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                    if !event.refs.isEmpty {
                        Text(event.refs.joined(separator: " · "))
                            .appFont(.system(size: 10.5))
                            .foregroundStyle(theme.textGhost)
                            .multilineTextAlignment(.leading)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "chevron.right")
                    .appFont(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textGhost)
                    .padding(.top, Spacing.sm)
            }
            .padding(.vertical, Spacing.xs)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open event \(event.title), \(AtlasPresentation.eventDateLabel(event))")
    }

    private func entityList(kind: AtlasEntityKind) -> some View {
        let state = kind == .person ? model.peopleState : model.placesState
        let entities = kind == .person ? model.people : model.places
        let cursor = kind == .person ? model.peopleNextCursor : model.placesNextCursor
        let noun = kind == .person ? "people" : "places"

        return Group {
            switch state {
            case .idle, .loading:
                atlasLoading("Opening \(noun)…")
            case .failed(let message):
                atlasError(message) { model.reloadEntities(kind: kind) }
            case .empty:
                atlasEmpty(AtlasPresentation.emptyDirectoryMessage(kind))
            case .loaded:
                LazyVStack(spacing: Spacing.xs) {
                    ForEach(entities) { entity in
                        Button { openDetail(.entity(entity.id), fromDetail: false) } label: {
                            HStack(spacing: Spacing.md) {
                                Image(systemName: kind == .person ? "person" : "mappin.and.ellipse")
                                    .foregroundStyle(theme.accent)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(entity.name)
                                        .appFont(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(theme.text)
                                    if let disambiguator = entity.disambiguator {
                                        Text(disambiguator)
                                            .appFont(.system(size: 10))
                                            .foregroundStyle(theme.accent)
                                    }
                                    if !entity.description.isEmpty {
                                        Text(entity.description)
                                            .appFont(.system(size: 11))
                                            .foregroundStyle(theme.textMuted)
                                            .lineLimit(2)
                                            .multilineTextAlignment(.leading)
                                    }
                                    Text(AtlasPresentation.entityRowMeta(entity))
                                        .appFont(.system(size: 10))
                                        .foregroundStyle(theme.textGhost)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .appFont(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(theme.textGhost)
                            }
                            .padding(.horizontal, Spacing.md)
                            .padding(.vertical, Spacing.sm)
                            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                            .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1) }
                            .contentShape(.rect(cornerRadius: Radius.md))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(
                            "\(entity.name)\(entity.disambiguator.map { ", \($0)" } ?? ""), \(kind == .person ? "person" : "place")"
                        )
                    }
                    // Directories load every page, as Android's do; this only
                    // appears if a later page failed to arrive.
                    if cursor != nil {
                        Button("Load more") { model.loadMoreEntities(kind: kind) }
                            .buttonStyle(AccentButtonStyle())
                            .padding(.top, Spacing.sm)
                    }
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.xl)
            }
        }
        .onAppear {
            if state == .idle {
                model.loadEntities(kind: kind, era: kind == .person ? model.selectedEra : nil, limit: 100, allPages: true)
            }
        }
    }

    private var searchContent: some View {
        ScrollView {
            Group {
                switch model.searchState {
                case .idle:
                    atlasLoading("Searching the atlas…")
                case .loading where model.searchResults.isEmpty:
                    // A refining query keeps the previous results visible.
                    atlasLoading("Searching the atlas…")
                case .failed(let message):
                    atlasError(message) { model.search(model.searchQuery) }
                case .empty:
                    atlasEmpty("Nothing in the atlas matches that search.")
                default:
                    LazyVStack(alignment: .leading, spacing: Spacing.lg) {
                        Text(AtlasPresentation.searchSummary(shown: model.searchResults.count, counts: model.searchCounts))
                            .appFont(.system(size: 11))
                            .foregroundStyle(theme.textFaint)
                        searchGroup(.person, count: model.searchCounts.person)
                        searchGroup(.place, count: model.searchCounts.place)
                        searchGroup(.event, count: model.searchCounts.event)
                    }
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.xl)
        }
    }

    private func searchGroup(_ kind: AtlasHitKind, count: Int) -> some View {
        let hits = model.searchResults.filter { $0.kind == kind }
        return Group {
            if !hits.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("\(AtlasPresentation.hitSectionLabel(kind)) (\(count))".uppercased())
                        .appFont(.system(size: 10, weight: .bold))
                        .kerning(1.1)
                        .foregroundStyle(theme.accent)
                    ForEach(hits) { hit in
                        Button {
                            switch hit.kind {
                            case .event: openDetail(.event(hit.id), fromDetail: false)
                            case .person, .place: openDetail(.entity(hit.id), fromDetail: false)
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(hit.name)
                                    .appFont(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(theme.text)
                                if let disambiguator = hit.disambiguator {
                                    Text(disambiguator)
                                        .appFont(.system(size: 10))
                                        .foregroundStyle(theme.accent)
                                }
                                Text(hit.description)
                                    .appFont(.system(size: 11))
                                    .foregroundStyle(theme.textMuted)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                Text(AtlasPresentation.searchRowMeta(hit))
                                    .appFont(.system(size: 10))
                                    .foregroundStyle(theme.textGhost)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(Spacing.md)
                            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                            .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1) }
                            .contentShape(.rect(cornerRadius: Radius.md))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(
                            "\(hit.name)\(hit.disambiguator.map { ", \($0)" } ?? ""), \(AtlasPresentation.hitKindLabel(hit.kind))"
                        )
                    }
                }
            }
        }
    }

    private var detailPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if history.canGoBack {
                    Button {
                        goBack()
                    } label: {
                        Label("Back", systemImage: "chevron.left")
                            .appFont(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.accent)
                    }
                    .buttonStyle(SubtleButtonStyle())
                    .help("Back to the previous entry")
                }
                Group {
                    if model.detailState.isLoading {
                        atlasLoading("Opening atlas detail…")
                    } else if model.detailNotFound {
                        atlasEmpty(model.selectedEventID != nil
                            ? AtlasPresentation.eventNotFoundMessage
                            : AtlasPresentation.entityNotFoundMessage)
                    } else if case .failed(let message) = model.detailState {
                        atlasError(message) {
                            if let id = model.selectedEntityID { model.loadEntity(id) }
                            else if let id = model.selectedEventID { model.loadEvent(id) }
                        }
                    } else if let event = model.selectedEvent {
                        eventDetail(event)
                    } else if let entity = model.selectedEntity {
                        entityDetail(entity)
                    } else {
                        atlasEmpty("Select an event, person, or place to explore it here.")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func eventDetail(_ event: AtlasEventView) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(event.title)
                .appFont(.custom(FontFamily.brand, size: 28))
                .foregroundStyle(theme.text)
            Text(AtlasPresentation.eventCaption(event))
                .appFont(.system(size: 11, weight: .semibold))
                .foregroundStyle(theme.accent)
            Text(AtlasPresentation.eventDateProvenanceLabel(event))
                .appFont(.system(size: 11))
                .foregroundStyle(theme.textGhost)
            Text(event.summary)
                .appFont(.system(size: 14))
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            detailLabel("In Scripture")
            referenceChips(event.refs)

            if !event.people.isEmpty || !event.places.isEmpty {
                detailLabel("Who and where")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), alignment: .leading)], alignment: .leading, spacing: Spacing.xs) {
                    ForEach(event.people + event.places) { entity in
                        Button { openDetail(.entity(entity.id), fromDetail: true) } label: { entityChip(entity) }
                            .buttonStyle(.plain)
                    }
                }
            }

            Button("✦ Ask about this") {
                app.chat.input = AtlasPresentation.askPrompt(for: event)
                app.section = .chat
            }
            .buttonStyle(AccentButtonStyle())
        }
    }

    private func entityDetail(_ entity: AtlasEntityView) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(entity.name)
                .appFont(.custom(FontFamily.brand, size: 30))
                .foregroundStyle(theme.text)
            if let disambiguator = entity.disambiguator {
                Text(disambiguator)
                    .appFont(.system(size: 12))
                    .foregroundStyle(theme.accent)
            }
            Text(AtlasPresentation.entitySubtitle(entity))
                .appFont(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.textMuted)
            let alsoCalled = AtlasPresentation.alsoCalledLine(entity)
            if !alsoCalled.isEmpty {
                Text(alsoCalled)
                    .appFont(.system(size: 12).italic())
                    .foregroundStyle(theme.textMuted)
            }
            Text(entity.description)
                .appFont(.system(size: 14))
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(AtlasPresentation.entityCounts(entity))
                .appFont(.system(size: 11))
                .foregroundStyle(theme.textGhost)

            detailLabel("In Scripture")
            referenceChips(entity.refs)

            let family = entity.kind == .person ? AtlasPresentation.immediateFamily(entity.relationDetails) : []
            let relationships = entity.relationDetails.filter { detail in
                !family.contains(where: { $0.id == detail.id })
            }
            let typedRelationIDs = Set(entity.relationDetails.map(\.entity.id))
            let legacyConnections = entity.related.filter { !typedRelationIDs.contains($0.id) }
            if !family.isEmpty {
                relationSection("Family", entries: family)
            }
            if !relationships.isEmpty {
                relationSection("Relationships", entries: relationships)
            }
            if !legacyConnections.isEmpty {
                detailLabel("Other recorded connections")
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 130), alignment: .leading)],
                    alignment: .leading,
                    spacing: Spacing.xs
                ) {
                    ForEach(legacyConnections) { connection in
                        Button {
                            openDetail(.entity(connection.id), fromDetail: true)
                        } label: {
                            entityChip(connection)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if !entity.events.isEmpty {
                detailLabel("On the timeline")
                ForEach(Array(entity.events.prefix(5))) { event in
                    Button { openDetail(.event(event.id), fromDetail: true) } label: {
                        HStack(alignment: .top, spacing: Spacing.sm) {
                            Text(event.yearLabel)
                                .appFont(.system(size: 10, weight: .bold))
                                .foregroundStyle(theme.accent)
                                .frame(width: 92, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(event.title)
                                    .appFont(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(theme.textSecondary)
                                    .multilineTextAlignment(.leading)
                                Text(event.era.rawValue)
                                    .appFont(.system(size: 10))
                                    .foregroundStyle(theme.textGhost)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .appFont(.system(size: 10, weight: .semibold))
                                .foregroundStyle(theme.textGhost)
                        }
                        .padding(.vertical, Spacing.xs)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open event \(event.title)")
                }
                if entity.kind == .person, entity.events.count > 5 {
                    Button("View all \(entity.events.count) events ›") { startJourney(entity) }
                        .buttonStyle(.plain)
                        .appFont(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.accent)
                }
            }

            if entity.kind == .person {
                Button("View journey") { startJourney(entity) }
                    .buttonStyle(AccentButtonStyle())
                    .help("Show \(entity.name)'s events on the timeline")
                traceControl(entityID: entity.id)
            }

            Button("✦ Ask about this") {
                app.chat.input = AtlasPresentation.askPrompt(for: entity)
                app.section = .chat
            }
            .buttonStyle(AccentButtonStyle())
        }
    }

    private func relationSection(_ title: String, entries: [AtlasNeighborhoodEntry]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            detailLabel(title)
            ForEach(entries) { entry in
                Button {
                    expandedRelationID = expandedRelationID == entry.id ? nil : entry.id
                } label: {
                    HStack(alignment: .top, spacing: Spacing.sm) {
                        Image(systemName: entry.entity.kind == .person ? "person" : "mappin.and.ellipse")
                            .foregroundStyle(theme.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.entity.name)
                                .appFont(.system(size: 12, weight: .semibold))
                                .foregroundStyle(theme.text)
                            if let disambiguator = entry.entity.disambiguator {
                                Text(disambiguator)
                                    .appFont(.system(size: 10))
                                    .foregroundStyle(theme.textMuted)
                            }
                            Text("\(entry.label) · \(AtlasPresentation.relationCertaintyLabel(entry.relation.certainty))")
                                .appFont(.system(size: 10))
                                .foregroundStyle(theme.textMuted)
                        }
                        Spacer()
                        Image(systemName: expandedRelationID == entry.id ? "chevron.down" : "chevron.right")
                            .appFont(.system(size: 10, weight: .semibold))
                            .foregroundStyle(theme.textGhost)
                    }
                    .padding(Spacing.sm)
                    .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                    .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1) }
                    .contentShape(.rect(cornerRadius: Radius.md))
                }
                .buttonStyle(.plain)
                if expandedRelationID == entry.id {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text("\(entry.label) · \(AtlasPresentation.relationCertaintyLabel(entry.relation.certainty))")
                            .appFont(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.accent)
                        referenceChips(entry.relation.refs)
                        Button("Open \(entry.entity.name)") { openDetail(.entity(entry.entity.id), fromDetail: true) }
                            .buttonStyle(SubtleButtonStyle())
                    }
                    .padding(.leading, Spacing.xl)
                }
            }
        }
    }

    /// Android's Trace page, inline: its own people-only search (never the
    /// explorer's search box) and a cited path whose people open in turn.
    private func traceControl(entityID: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Button(traceExpanded ? "Hide connection trace" : "Trace connection") {
                traceExpanded.toggle()
                traceQuery = ""
                traceTargetID = nil
                model.resetTrace()
            }
            .buttonStyle(AccentButtonStyle())

            if traceExpanded {
                Text(AtlasPresentation.traceSubtitle)
                    .appFont(.system(size: 11))
                    .foregroundStyle(theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                TextField("Search a person", text: Binding(get: { traceQuery }, set: { next in
                    traceQuery = next
                    traceTargetID = nil
                    model.searchTracePeople(next, excluding: entityID)
                }))
                .textFieldStyle(.roundedBorder)
                .appFont(.system(size: 12))
                .accessibilityLabel("Search a person to trace")

                if traceTargetID == nil, !traceQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    traceCandidates(entityID: entityID)
                }
                if let target = traceTargetID {
                    traceOutcome(from: entityID, to: target)
                }
            }
        }
    }

    @ViewBuilder private func traceCandidates(entityID: String) -> some View {
        switch model.traceSearchState {
        case .idle, .loading:
            ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 32)
        case .failed(let message):
            atlasError(message) { model.searchTracePeople(traceQuery, excluding: entityID) }
        case .empty, .loaded:
            ForEach(model.traceResults) { hit in
                Button {
                    traceTargetID = hit.id
                    model.traceConnection(from: entityID, to: hit.id)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(hit.name).appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text)
                        if let disambiguator = hit.disambiguator {
                            Text(disambiguator).appFont(.system(size: 10)).foregroundStyle(theme.accent)
                        }
                        Text(hit.era?.rawValue ?? "Person")
                            .appFont(.system(size: 10))
                            .foregroundStyle(theme.textGhost)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, Spacing.xs)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Trace to \(hit.name)\(hit.disambiguator.map { ", \($0)" } ?? "")")
            }
        }
    }

    @ViewBuilder private func traceOutcome(from entityID: String, to targetID: String) -> some View {
        // Only a path from this person to the chosen target is ever shown.
        if let path = model.connectionPath, path.ids.first == entityID, path.ids.last == targetID {
            detailLabel("Shortest cited path")
            ForEach(Array(path.entities.enumerated()), id: \.offset) { index, step in
                VStack(alignment: .leading, spacing: 2) {
                    Button {
                        openDetail(.entity(step.id), fromDetail: true)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(index + 1). \(step.name)")
                                .appFont(.system(size: 12, weight: .semibold))
                                .foregroundStyle(theme.accent)
                            if let disambiguator = step.disambiguator {
                                Text(disambiguator).appFont(.system(size: 10)).foregroundStyle(theme.textMuted)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Spacing.sm)
                        .background(theme.accentSoft, in: .rect(cornerRadius: Radius.md))
                        .contentShape(.rect(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)
                    .help("Open \(step.name)")
                    .accessibilityLabel("Open \(step.name)\(step.disambiguator.map { ", \($0)" } ?? "")")
                    if index < path.relations.count {
                        let relation = path.relations[index]
                        Text("\(AtlasRelationLabels.label(for: relation, perspectiveID: step.id)) · \(AtlasPresentation.relationCertaintyLabel(relation.certainty))")
                            .appFont(.system(size: 10))
                            .foregroundStyle(theme.textMuted)
                        referenceChips(relation.refs)
                    }
                }
                .padding(.vertical, Spacing.xs)
            }
        } else if model.connectionNotFound {
            atlasEmpty(AtlasPresentation.traceNoPathMessage)
        } else if case .failed(let message) = model.connectionState {
            atlasError(message) { model.traceConnection(from: entityID, to: targetID) }
        } else {
            atlasLoading("Tracing the shortest cited path…")
        }
    }

    private func referenceChips(_ refs: [String]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), alignment: .leading)], alignment: .leading, spacing: Spacing.xs) {
            ForEach(refs, id: \.self) { reference in
                Button(AtlasPresentation.referenceChipLabel(reference)) { onOpenReference(reference) }
                    .buttonStyle(SubtleButtonStyle())
                    .foregroundStyle(theme.accent)
                    .appFont(.system(size: 11, weight: .semibold))
                    .help("Open \(reference) in the Bible reader")
                    .accessibilityLabel("Open \(reference) in the Bible reader")
            }
        }
    }

    private func entityChip(_ entity: AtlasEntityRef) -> some View {
        HStack(spacing: Spacing.xs) {
            Image(systemName: entity.kind == .person ? "person" : "mappin.and.ellipse")
                .appFont(.system(size: 10))
            VStack(alignment: .leading, spacing: 1) {
                Text(entity.name).appFont(.system(size: 11, weight: .semibold))
                if let disambiguator = entity.disambiguator {
                    Text(disambiguator).appFont(.system(size: 9)).foregroundStyle(theme.textMuted)
                }
            }
        }
        .foregroundStyle(theme.accent)
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(theme.accentSoft, in: .rect(cornerRadius: Radius.md))
        .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.accentBorder, lineWidth: 1) }
    }

    private func detailLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .appFont(.system(size: 10, weight: .bold))
            .kerning(1.1)
            .foregroundStyle(theme.textMuted)
            .padding(.top, Spacing.sm)
    }

    // MARK: Navigation

    /// First appearance for this scope: a clean rail in the requested mode.
    /// A return to the same pane keeps whatever the reader had chosen.
    private func start() {
        guard startedKey != scopeKey else { return }
        startedKey = scopeKey
        model.selectedEra = nil
        model.clearSearch()
        if let scopedBook, let scopedChapter, chapterScope != nil {
            model.loadChapter(book: scopedBook, chapter: scopedChapter)
        }
        setMode(initialMode)
    }

    private func setMode(_ next: AtlasExplorerMode) {
        mode = next
        // A journey belongs to the rail it was opened on; any other view
        // (and a return to the timeline) shows everything again.
        journeyName = nil
        if next == .places { model.selectedEra = nil }
        switch next {
        case .timeline:
            model.loadTimeline(era: model.selectedEra, book: scopedBook, chapter: scopedChapter)
        case .people:
            model.loadEntities(kind: .person, era: model.selectedEra, limit: 100, allPages: true)
        case .places:
            model.loadEntities(kind: .place, limit: 100, allPages: true)
        }
    }

    /// "View journey": the rail filtered to one person, named in the bar
    /// above it, rather than their raw atlas id.
    private func startJourney(_ entity: AtlasEntityView) {
        mode = .timeline
        journeyName = entity.name
        model.loadPersonJourney(entity.id)
    }

    private func clearJourney() {
        journeyName = nil
        model.loadTimeline(era: model.selectedEra, book: scopedBook, chapter: scopedChapter)
    }

    /// Android pushes a page per entry, so Back walks the chain; here the
    /// detail column keeps it. The list starts a new chain.
    private func openDetail(_ ref: AtlasDetailRef, fromDetail: Bool) {
        history.open(ref, fromDetail: fromDetail)
        load(ref)
    }

    private func goBack() {
        if let ref = history.back() { load(ref) }
    }

    private func load(_ ref: AtlasDetailRef) {
        switch ref {
        case .entity(let id): model.loadEntity(id)
        case .event(let id): model.loadEvent(id)
        }
    }

    private func atlasLoading(_ text: String) -> some View {
        VStack(spacing: Spacing.sm) {
            ProgressView().controlSize(.small)
            Text(text).appFont(.system(size: 12)).foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.xxl)
    }

    private func atlasEmpty(_ text: String) -> some View {
        GlassCard {
            Text(text)
                .appFont(.system(size: 13))
                .foregroundStyle(theme.textMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        .padding(.vertical, Spacing.xl)
    }

    private func atlasError(_ message: String, retry: @escaping () -> Void) -> some View {
        GlassCard {
            VStack(spacing: Spacing.md) {
                Text(message)
                    .appFont(.system(size: 13))
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.center)
                Button("Try again", action: retry)
                    .buttonStyle(AccentButtonStyle())
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.vertical, Spacing.xl)
    }
}
