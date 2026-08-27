import SwiftUI

/// Desktop Timeline / People / Places explorer. The data and request
/// cancellation live in AtlasModel; this view only composes the native list
/// and detail panes around that shared state.
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

    @State private var mode: AtlasExplorerMode = .timeline
    @State private var expandedRelationID: String?
    @State private var traceExpanded = false
    @State private var traceQuery = ""
    @State private var traceTargetID: String?

    var body: some View {
        HStack(spacing: 0) {
            listPane
                .frame(minWidth: 360, idealWidth: 440, maxWidth: 520)

            Divider().overlay(theme.border)

            detailPane
                .frame(minWidth: 340, idealWidth: 410, maxWidth: 480)
        }
        .task {
            if let scopedBook {
                model.loadTimeline(book: scopedBook, chapter: scopedChapter)
            } else {
                model.loadTimeline()
            }
        }
        .onChange(of: model.selectedEntityID) { _, _ in
            expandedRelationID = nil
            traceExpanded = false
            traceQuery = ""
            traceTargetID = nil
        }
    }

    private var listPane: some View {
        VStack(spacing: 0) {
            header
            searchField

            if mode != .places && model.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                eraScroller
            }

            if model.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                modeContent
            } else {
                searchContent
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var header: some View {
        HStack(spacing: Spacing.md) {
            Button(action: onDismiss) {
                Label("Bible", systemImage: "chevron.left")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .buttonStyle(SubtleButtonStyle())
            .help("Back to Bible")

            Text("Timeline & People")
                .font(.custom(FontFamily.brand, size: 24))
                .foregroundStyle(theme.text)

            Spacer()
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.lg)
    }

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12))
                .foregroundStyle(theme.textGhost)

            TextField(
                "Search people, places and events",
                text: Binding(
                    get: { model.searchQuery },
                    set: { model.search($0) }
                )
            )
            .textFieldStyle(.plain)
            .font(.system(size: 13))
            .foregroundStyle(theme.text)

            if !model.searchQuery.isEmpty {
                Button {
                    model.clearSearch()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12))
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
                ForEach(model.allEras) { era in
                    eraButton(era, title: shortEra(era))
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.xs)
        }
    }

    private func eraButton(_ era: AtlasEra?, title: String) -> some View {
        let active = model.selectedEra == era
        return Button {
            switch mode {
            case .timeline:
                model.selectedEra = era
                model.loadTimeline(
                    era: era,
                    book: scopedBook,
                    chapter: scopedChapter,
                    personID: model.journeyPersonID
                )
            case .people:
                model.selectedEra = era
                model.loadEntities(kind: .person, era: era)
            case .places:
                // Places have no era dimension.
                break
            }
        } label: {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(active ? theme.accent : theme.textMuted)
                .padding(.horizontal, Spacing.sm)
                .padding(.vertical, 6)
                .background(active ? theme.accentSoft : theme.surface, in: .capsule)
                .overlay {
                    Capsule().strokeBorder(active ? theme.accentBorder : theme.border, lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
        .help(title)
    }

    private var modePicker: some View {
        // An explicit closure, not `set: setMode`: partially applying the
        // @MainActor method here makes the Swift 6.2 compiler (Xcode 26.6)
        // crash in IRGen on the reabstraction thunk.
        Picker("Atlas view", selection: Binding(get: { mode }, set: { setMode($0) })) {
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
        Group {
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
                atlasEmpty("No events match this timeline filter.")
            case .loaded:
                LazyVStack(alignment: .leading, spacing: 0) {
                    if scopedBook != nil, !scopedEntities.isEmpty {
                        Text("WHO'S IN THIS CHAPTER")
                            .font(.system(size: 10, weight: .bold))
                            .kerning(1.1)
                            .foregroundStyle(theme.accent)
                            .padding(.bottom, Spacing.sm)
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)],
                            alignment: .leading,
                            spacing: Spacing.xs
                        ) {
                            ForEach(scopedEntities) { entity in
                                Button {
                                    model.loadEntity(entity.id)
                                } label: {
                                    entityChip(entity)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.bottom, Spacing.md)
                    }
                    if let journey = model.journeyPersonID {
                        Text("Journey · \(journey)")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.accent)
                            .padding(.bottom, Spacing.sm)
                    }
                    ForEach(model.timelineGroups) { group in
                        Text(group.era.rawValue)
                            .font(.system(size: 10, weight: .bold))
                            .kerning(1.1)
                            .foregroundStyle(theme.textMuted)
                            .padding(.top, Spacing.md)
                            .padding(.bottom, Spacing.sm)

                        ForEach(Array(group.events.enumerated()), id: \.element.id) { index, event in
                            eventRow(event, isLast: index == group.events.count - 1)
                        }
                    }
                    Text("Dates follow the traditional Ussher chronology carried in the margins of the King James Bible; they are not part of the inspired text.")
                        .font(.system(size: 10))
                        .foregroundStyle(theme.textGhost)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, Spacing.lg)
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.xl)
            }
        }
    }

    private func eventRow(_ event: AtlasEventView, isLast: Bool) -> some View {
        Button {
            model.loadEvent(event.id)
        } label: {
            HStack(alignment: .top, spacing: Spacing.md) {
                VStack(spacing: 0) {
                    Text("✦")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.accent)
                        .frame(width: 26, height: 26)
                        .background(theme.accentSoft, in: .circle)
                        .overlay { Circle().strokeBorder(theme.accentBorder, lineWidth: 1) }
                    if !isLast {
                        Rectangle()
                            .fill(theme.accentBorder)
                            .frame(width: 1, height: 52)
                    }
                }

                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(atlasDateLabel(event))
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text(event.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(theme.text)
                        .multilineTextAlignment(.leading)
                    Text(event.summary)
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.textGhost)
                    .padding(.top, Spacing.sm)
            }
            .padding(.vertical, Spacing.xs)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open event \(event.title), \(atlasDateLabel(event))")
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
                atlasError(message) { model.loadEntities(kind: kind, era: kind == .person ? model.selectedEra : nil) }
            case .empty:
                atlasEmpty("No \(noun) match this filter.")
            case .loaded:
                LazyVStack(spacing: Spacing.xs) {
                    ForEach(entities) { entity in
                        Button { model.loadEntity(entity.id) } label: {
                            HStack(spacing: Spacing.md) {
                                Image(systemName: kind == .person ? "person" : "mappin.and.ellipse")
                                    .foregroundStyle(theme.accent)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(entity.name)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(theme.text)
                                    if let disambiguator = entity.disambiguator {
                                        Text(disambiguator)
                                            .font(.system(size: 10))
                                            .foregroundStyle(theme.textMuted)
                                    }
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(theme.textGhost)
                            }
                            .padding(.horizontal, Spacing.md)
                            .padding(.vertical, Spacing.sm)
                            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                            .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1) }
                            .contentShape(.rect(cornerRadius: Radius.md))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(entity.disambiguator.map { "\(entity.name), \($0)" } ?? entity.name)
                    }
                    if cursor != nil {
                        Button("Load more") {
                            model.loadEntities(kind: kind, era: kind == .person ? model.selectedEra : nil, cursor: cursor)
                        }
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
                model.loadEntities(kind: kind, era: kind == .person ? model.selectedEra : nil)
            }
        }
    }

    private var searchContent: some View {
        ScrollView {
            switch model.searchState {
            case .idle, .loading:
                atlasLoading("Searching the atlas…")
            case .failed(let message):
                atlasError(message) { model.search(model.searchQuery) }
            case .empty:
                atlasEmpty("Nothing in the atlas matches that search.")
            case .loaded:
                LazyVStack(alignment: .leading, spacing: Spacing.lg) {
                    searchGroup("People", count: model.searchCounts.person, hits: model.searchResults.filter { $0.kind == .person })
                    searchGroup("Places", count: model.searchCounts.place, hits: model.searchResults.filter { $0.kind == .place })
                    searchGroup("Events", count: model.searchCounts.event, hits: model.searchResults.filter { $0.kind == .event })
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.xl)
            }
        }
    }

    private func searchGroup(_ title: String, count: Int, hits: [AtlasSearchHit]) -> some View {
        Group {
            if !hits.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("\(title) · \(count)")
                        .font(.system(size: 10, weight: .bold))
                        .kerning(1.1)
                        .foregroundStyle(theme.accent)
                    ForEach(hits) { hit in
                        Button {
                            switch hit.kind {
                            case .event: model.loadEvent(hit.id)
                            case .person, .place: model.loadEntity(hit.id)
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(hit.name)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(theme.text)
                                if let disambiguator = hit.disambiguator {
                                    Text(disambiguator)
                                        .font(.system(size: 10))
                                        .foregroundStyle(theme.textMuted)
                                }
                                Text(hit.description)
                                    .font(.system(size: 11))
                                    .foregroundStyle(theme.textMuted)
                                    .lineLimit(2)
                                if hit.kind == .event {
                                    Text(atlasSearchDateLabel(hit))
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(theme.accent)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(Spacing.md)
                            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                            .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1) }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var detailPane: some View {
        ScrollView {
            Group {
                if model.detailState.isLoading {
                    atlasLoading("Opening atlas detail…")
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func eventDetail(_ event: AtlasEventView) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(event.title)
                .font(.custom(FontFamily.brand, size: 28))
                .foregroundStyle(theme.text)
            Text("\(atlasDateLabel(event)) · \(event.era.rawValue)")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(theme.accent)
            Text(event.summary)
                .font(.system(size: 14))
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            detailLabel("In Scripture")
            referenceChips(event.refs)

            if !event.people.isEmpty || !event.places.isEmpty {
                detailLabel("Who and where")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), alignment: .leading)], alignment: .leading, spacing: Spacing.xs) {
                    ForEach(event.people + event.places) { entity in
                        Button { model.loadEntity(entity.id) } label: { entityChip(entity) }
                            .buttonStyle(.plain)
                    }
                }
            }

            Button("✦ Ask about this") {
                app.chat.input = "Tell me about \(event.title) (\(event.yearLabel)) from the KJV."
                app.section = .chat
            }
            .buttonStyle(AccentButtonStyle())
        }
    }

    private func entityDetail(_ entity: AtlasEntityView) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(entity.name)
                .font(.custom(FontFamily.brand, size: 30))
                .foregroundStyle(theme.text)
            if let disambiguator = entity.disambiguator {
                Text(disambiguator)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textMuted)
            }
            Text(entity.kind == .person ? "Person" : "Place")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.accent)
            if !entity.alsoCalled.isEmpty {
                Text("Also called \(entity.alsoCalled.joined(separator: ", "))")
                    .font(.system(size: 12).italic())
                    .foregroundStyle(theme.textMuted)
            }
            Text(entity.description)
                .font(.system(size: 14))
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            detailLabel("In Scripture")
            referenceChips(entity.refs)

            let family = entity.relationDetails.filter { detail in
                entity.kind == .person && [.parent, .spouse, .sibling].contains(detail.relation.type)
            }
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
                            model.loadEntity(connection.id)
                        } label: {
                            entityChip(connection)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            if entity.kind == .person, !entity.relationDetails.isEmpty {
                traceControl(entityID: entity.id)
            }

            if !entity.events.isEmpty {
                detailLabel("On the timeline")
                ForEach(Array(entity.events.prefix(5))) { event in
                    Button { model.loadEvent(event.id) } label: {
                        HStack(alignment: .top, spacing: Spacing.sm) {
                            Text(atlasEntityDateLabel(event.yearLabel))
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(theme.accent)
                                .frame(width: 150, alignment: .leading)
                            Text(event.title)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(theme.textSecondary)
                                .multilineTextAlignment(.leading)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(theme.textGhost)
                        }
                        .padding(.vertical, Spacing.xs)
                    }
                    .buttonStyle(.plain)
                }
                if entity.kind == .person, entity.events.count > 5 {
                    Button("View all \(entity.events.count) events") {
                        model.loadPersonJourney(entity.id)
                        mode = .timeline
                    }
                    .buttonStyle(AccentButtonStyle())
                }
            }

            Button("✦ Ask about this") {
                app.chat.input = entity.kind == .person
                    ? "Who was \(entity.name) in the Bible, and what can I learn from them?"
                    : "What happened at \(entity.name) in the Bible?"
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
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(theme.text)
                            if let disambiguator = entry.entity.disambiguator {
                                Text(disambiguator)
                                    .font(.system(size: 10))
                                    .foregroundStyle(theme.textMuted)
                            }
                            Text("\(entry.label) · \(entry.relation.certainty.rawValue)")
                                .font(.system(size: 10))
                                .foregroundStyle(theme.textMuted)
                        }
                        Spacer()
                        Image(systemName: expandedRelationID == entry.id ? "chevron.down" : "chevron.right")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(theme.textGhost)
                    }
                    .padding(Spacing.sm)
                    .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                    .overlay { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.border, lineWidth: 1) }
                }
                .buttonStyle(.plain)
                if expandedRelationID == entry.id {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text("\(entry.label) · \(entry.relation.certainty.rawValue)")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.accent)
                        referenceChips(entry.relation.refs)
                        Button("Open \(entry.entity.name)") { model.loadEntity(entry.entity.id) }
                            .buttonStyle(SubtleButtonStyle())
                    }
                    .padding(.leading, Spacing.xl)
                }
            }
        }
    }

    private func traceControl(entityID: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Button(traceExpanded ? "Hide connection trace" : "Trace connection") {
                traceExpanded.toggle()
                if !traceExpanded {
                    traceTargetID = nil
                }
            }
            .buttonStyle(AccentButtonStyle())

            if traceExpanded {
                TextField("Search any person", text: Binding(get: { traceQuery }, set: {
                    traceQuery = $0
                    model.search($0)
                }))
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12))

                if traceTargetID == nil {
                    ForEach(model.searchResults.filter { $0.kind == .person && $0.id != entityID }) { hit in
                        Button {
                            traceTargetID = hit.id
                            traceQuery = hit.name
                            model.traceConnection(from: entityID, to: hit.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(hit.name).font(.system(size: 12, weight: .semibold))
                                if let disambiguator = hit.disambiguator {
                                    Text(disambiguator).font(.system(size: 10)).foregroundStyle(theme.textMuted)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, Spacing.xs)
                        }
                        .buttonStyle(.plain)
                    }
                }

                if model.connectionState.isLoading {
                    atlasLoading("Tracing the shortest cited path…")
                } else if case .failed(let message) = model.connectionState {
                    atlasError(message) { if let target = traceTargetID { model.traceConnection(from: entityID, to: target) } }
                } else if let path = model.connectionPath {
                    ForEach(Array(path.entities.enumerated()), id: \.offset) { index, step in
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(index + 1). \(step.name)")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(theme.text)
                            if let disambiguator = step.disambiguator {
                                Text(disambiguator).font(.system(size: 10)).foregroundStyle(theme.textMuted)
                            }
                            if index < path.relations.count {
                                let relation = path.relations[index]
                                Text("\(AtlasRelationLabels.label(for: relation, perspectiveID: step.id)) · \(relation.certainty.rawValue)")
                                    .font(.system(size: 10))
                                    .foregroundStyle(theme.textMuted)
                                referenceChips(relation.refs)
                            }
                        }
                        .padding(.vertical, Spacing.xs)
                    }
                }
            }
        }
    }

    private func referenceChips(_ refs: [String]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), alignment: .leading)], alignment: .leading, spacing: Spacing.xs) {
            ForEach(refs, id: \.self) { reference in
                Button(reference) { onOpenReference(reference) }
                    .buttonStyle(SubtleButtonStyle())
                    .foregroundStyle(theme.accent)
                    .font(.system(size: 11, weight: .semibold))
                    .help("Open \(reference) in the Bible reader")
                    .accessibilityLabel("Open \(reference) in the Bible reader")
            }
        }
    }

    private func entityChip(_ entity: AtlasEntityRef) -> some View {
        HStack(spacing: Spacing.xs) {
            Image(systemName: entity.kind == .person ? "person" : "mappin.and.ellipse")
                .font(.system(size: 10))
            VStack(alignment: .leading, spacing: 1) {
                Text(entity.name).font(.system(size: 11, weight: .semibold))
                if let disambiguator = entity.disambiguator {
                    Text(disambiguator).font(.system(size: 9)).foregroundStyle(theme.textMuted)
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
            .font(.system(size: 10, weight: .bold))
            .kerning(1.1)
            .foregroundStyle(theme.textMuted)
            .padding(.top, Spacing.sm)
    }

    private func setMode(_ next: AtlasExplorerMode) {
        mode = next
        if next == .places { model.selectedEra = nil }
        switch next {
        case .timeline:
            model.loadTimeline(
                era: model.selectedEra,
                book: scopedBook,
                chapter: scopedChapter,
                personID: model.journeyPersonID
            )
        case .people:
            model.loadEntities(kind: .person, era: model.selectedEra)
        case .places:
            model.loadEntities(kind: .place)
        }
    }

    private func shortEra(_ era: AtlasEra) -> String {
        switch era {
        case .creationAndPatriarchs: "Patriarchs"
        case .egyptAndExodus: "Exodus"
        case .conquestAndJudges: "Judges"
        case .unitedKingdom: "Kingdom"
        case .dividedKingdom: "Divided"
        case .exileAndReturn: "Exile"
        case .betweenTheTestaments: "Silence"
        case .lifeOfChrist: "Christ"
        case .earlyChurch: "Church"
        }
    }

    private func atlasDateLabel(_ event: AtlasEventView) -> String {
        guard let date = event.date else { return atlasEntityDateLabel(event.yearLabel) }
        switch date.provenance {
        case .traditionalUssher: return "Traditional chronology · \(date.label)"
        case .scriptureExplicit: return date.label
        case .undated: return "Date not given"
        }
    }

    private func atlasSearchDateLabel(_ hit: AtlasSearchHit) -> String {
        guard let yearLabel = hit.yearLabel, !yearLabel.isEmpty, yearLabel.lowercased() != "undated" else { return "Date not given" }
        return "Traditional chronology · \(yearLabel)"
    }

    private func atlasEntityDateLabel(_ yearLabel: String) -> String {
        yearLabel.lowercased() == "undated" ? "Date not given" : "Traditional chronology · \(yearLabel)"
    }

    private var scopedEntities: [AtlasEntityRef] {
        var seen = Set<String>()
        return model.timelineEvents
            .flatMap { $0.people + $0.places }
            .filter { seen.insert($0.id).inserted }
    }

    private func atlasLoading(_ text: String) -> some View {
        VStack(spacing: Spacing.sm) {
            ProgressView().controlSize(.small)
            Text(text).font(.system(size: 12)).foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.xxl)
    }

    private func atlasEmpty(_ text: String) -> some View {
        GlassCard {
            Text(text)
                .font(.system(size: 13))
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
                    .font(.system(size: 13))
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

private enum AtlasExplorerMode: String, CaseIterable, Identifiable {
    case timeline, people, places

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}
