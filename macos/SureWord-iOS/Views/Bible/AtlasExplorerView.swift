import SwiftUI

/// Native iOS Timeline, People, and Places explorer. The model is shared with
/// the other native client; this view owns only presentation mode and the
/// current chapter scope passed by the reader.
struct AtlasExplorerView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    @Bindable var model: AtlasModel
    let scopedBook: Int?
    let scopedChapter: Int?
    let journeyPersonID: String?

    @State private var mode: AtlasExplorerMode = .timeline

    init(model: AtlasModel, book: Int? = nil, chapter: Int? = nil, personID: String? = nil) {
        self.model = model
        scopedBook = book
        scopedChapter = chapter
        journeyPersonID = personID
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.sm) {
                searchField
                modePicker
                if mode != .places && scopedBook == nil {
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
        .background { MeshBackground() }
        .navigationTitle(atlasTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task { loadInitial() }
        .onChange(of: mode) { _, next in
            switch next {
            case .timeline: loadTimeline()
            case .people:
                model.selectedEra = nil
                model.loadEntities(kind: .person, era: nil)
            case .places:
                model.selectedEra = nil
                model.loadEntities(kind: .place, era: nil)
            }
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
                .accessibilityLabel("Clear atlas search")
            }
        }
        .padding(.horizontal, Spacing.md)
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
                ForEach(model.allEras) { era in
                    eraButton(era, title: era.shortTitle)
                }
            }
            .padding(.vertical, Spacing.xs)
        }
        .frame(height: 52)
    }

    private func eraButton(_ era: AtlasEra?, title: String) -> some View {
        Button {
            let nextEra = model.selectedEra == era ? nil : era
            switch mode {
            case .timeline:
                model.loadTimeline(
                    era: nextEra,
                    book: scopedBook,
                    chapter: scopedChapter,
                    personID: journeyPersonID
                )
            case .people:
                model.selectedEra = nextEra
                model.loadEntities(kind: .person, era: nextEra)
            case .places:
                break
            }
        } label: {
            Text(title)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(model.selectedEra == era ? theme.accent : theme.textMuted)
                .padding(.horizontal, Spacing.md)
                .frame(minHeight: 44)
                .background(model.selectedEra == era ? theme.accentSoft : theme.surface, in: .capsule)
                .overlay { Capsule().strokeBorder(model.selectedEra == era ? theme.accentBorder : theme.borderStrong, lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title == "All" ? "All eras" : era?.rawValue ?? title)
        .accessibilityAddTraits(model.selectedEra == era ? .isSelected : [])
    }

    @ViewBuilder private var browseBody: some View {
        switch mode {
        case .timeline:
            if scopedBook != nil {
                chapterHeader
            }
            timelineBody
        case .people:
            entityDirectory(kind: .person, items: model.people, state: model.peopleState)
        case .places:
            entityDirectory(kind: .place, items: model.places, state: model.placesState)
        }
    }

    @ViewBuilder private var timelineBody: some View {
        switch model.timelineState {
        case .idle, .loading:
            loadingView("Opening the timeline…")
        case .failed(let message):
            retryCard(message) { loadTimeline() }
        case .empty:
            emptyCard(scopedBook == nil ? "No events on the timeline." : "The atlas has no events recorded for this chapter.")
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
                    Text(event.date?.label ?? event.yearLabel)
                        .font(.system(size: 11.5, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text(dateProvenance(event))
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
            .accessibilityLabel("\(event.title), \(event.date?.label ?? event.yearLabel)")
        }
    }

    private var chronologyNote: some View {
        Text("Dates marked Traditional Ussher chronology are a reckoning from Scripture's genealogies, not dates stated by Scripture itself. Scripture-explicit and undated events retain those labels.")
            .font(.system(size: 11.5))
            .foregroundStyle(theme.textGhost)
            .padding(.top, Spacing.md)
            .accessibilityLabel("Chronology note")
    }

    private func dateProvenance(_ event: AtlasEventView) -> String {
        switch event.date?.provenance {
        case .scriptureExplicit: "Scripture-explicit date"
        case .undated: "Date not given"
        default: "Traditional Ussher chronology"
        }
    }

    @ViewBuilder private func entityDirectory(kind: AtlasEntityKind, items: [AtlasEntitySummary], state: AtlasLoadState) -> some View {
        switch state {
        case .idle, .loading: loadingView(kind == .person ? "Opening people…" : "Opening places…")
        case .failed(let message): retryCard(message) { model.loadEntities(kind: kind) }
        case .empty: emptyCard(kind == .person ? "No people are recorded in the atlas." : "No places are recorded in the atlas.")
        case .loaded:
            ForEach(items) { entity in
                NavigationLink { AtlasEntityDetailView(model: model, entityID: entity.id, openReference: openReference) } label: {
                    entityRow(entity)
                }
                .buttonStyle(.plain)
            }
            if (kind == .person ? model.peopleNextCursor : model.placesNextCursor) != nil {
                Button("Load more") {
                    model.loadEntities(kind: kind, cursor: kind == .person ? model.peopleNextCursor : model.placesNextCursor)
                }
                .buttonStyle(AccentButtonStyle())
                .frame(maxWidth: .infinity, minHeight: 44)
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
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .padding(.horizontal, Spacing.lg)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(entity.name), \(entity.kind == .person ? "person" : "place")")
    }

    private var chapterHeader: some View {
        let entities = chapterEntities
        return Group {
            if !entities.isEmpty {
                Text("WHO'S IN THIS CHAPTER")
                    .font(.system(size: 11.5, weight: .bold))
                    .kerning(1.1)
                    .foregroundStyle(theme.accentDim)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.sm) {
                        ForEach(entities) { entity in
                            NavigationLink { AtlasEntityDetailView(model: model, entityID: entity.id, openReference: openReference) } label: {
                                Text(entity.name)
                                    .foregroundStyle(theme.textSecondary)
                                    .padding(.horizontal, Spacing.md)
                                    .frame(minHeight: 44)
                                    .background(theme.surface, in: .capsule)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var searchBody: some View {
        switch model.searchState {
        case .idle, .loading where model.searchResults.isEmpty:
            loadingView("Searching the atlas…")
        case .failed(let message): retryCard(message) { model.search(model.searchQuery) }
        case .empty: emptyCard("Nothing in the atlas matches that search.")
        default:
            Text("\(model.searchCounts.total) results · showing up to 12")
                .font(.system(size: 12))
                .foregroundStyle(theme.textFaint)
            ForEach([AtlasHitKind.person, .place, .event], id: \.self) { kind in
                let hits = model.searchResults.filter { $0.kind == kind }
                if !hits.isEmpty {
                    Text("\(kind.title) (\(count(for: kind)))")
                        .font(.system(size: 11.5, weight: .bold))
                        .kerning(1.1)
                        .foregroundStyle(theme.accentDim)
                        .padding(.top, Spacing.md)
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
    }

    private func searchRowLabel(_ hit: AtlasSearchHit) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(hit.name).font(.system(size: 15, weight: .bold)).foregroundStyle(theme.text)
                if let disambiguator = hit.disambiguator { Text(disambiguator).font(.system(size: 12)).foregroundStyle(theme.accent) }
                Text(hit.description).font(.system(size: 13)).foregroundStyle(theme.textMuted).lineLimit(2)
                Text(hit.refs.first ?? hit.yearLabel ?? "").font(.system(size: 11.5)).foregroundStyle(theme.textGhost)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .padding(.horizontal, Spacing.lg)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) }
    }

    private func count(for kind: AtlasHitKind) -> Int {
        switch kind { case .person: model.searchCounts.person;
case .place: model.searchCounts.place;
case .event: model.searchCounts.event }
    }

    @ToolbarContentBuilder private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { model.clearSearch() } label: { Image(systemName: "line.3.horizontal.decrease.circle") }
                .accessibilityLabel("Reset atlas search")
        }
    }

    private func loadInitial() {
        if scopedBook != nil {
            model.loadTimeline(book: scopedBook, chapter: scopedChapter)
        } else if let journeyPersonID {
            model.clearSearch()
            model.loadTimeline(personID: journeyPersonID)
        } else {
            model.loadTimeline()
        }
    }

    private var atlasTitle: String {
        if let scopedBook, let book = Bible.book(order: scopedBook) {
            return "\(book.name) \(scopedChapter ?? 1)"
        }
        if journeyPersonID != nil { return "Person journey" }
        return mode.title
    }

    private func loadTimeline() {
        model.loadTimeline(
            era: model.selectedEra,
            book: scopedBook,
            chapter: scopedChapter,
            personID: journeyPersonID ?? model.journeyPersonID
        )
    }

    private var chapterEntities: [AtlasEntityRef] {
        var seen = Set<String>()
        return model.timelineEvents
            .flatMap { $0.people + $0.places }
            .filter { seen.insert($0.id).inserted }
    }

    private func openReference(_ raw: String) -> AnyView {
        guard let reference = Bible.resolveReference(raw) else { return AnyView(Text(raw).foregroundStyle(theme.textGhost)) }
        return AnyView(NavigationLink { ChapterReaderView(order: reference.order, chapter: reference.chapter, verse: reference.verse) } label: {
            Text(raw).foregroundStyle(theme.accent).padding(.horizontal, Spacing.md).frame(minHeight: 44).background(theme.accentSoft, in: .capsule)
        }.buttonStyle(.plain).accessibilityLabel("Read \(raw)"))
    }

    private func loadingView(_ title: String) -> some View { VStack(spacing: Spacing.md) { ProgressView();
Text(title).font(.system(size: 13)).foregroundStyle(theme.textFaint) }.frame(maxWidth: .infinity).padding(.vertical, Spacing.xxl) }
    private func emptyCard(_ message: String) -> some View { GlassCard { Text(message).font(.system(size: 14)).foregroundStyle(theme.textSecondary).frame(maxWidth: .infinity, alignment: .leading) } }
    private func retryCard(_ message: String, retry: @escaping () -> Void) -> some View { GlassCard { VStack(spacing: Spacing.md) { Text(message).font(.system(size: 14)).foregroundStyle(theme.textSecondary).multilineTextAlignment(.center);
Button("Try again", action: retry).buttonStyle(AccentButtonStyle()) } }.frame(maxWidth: .infinity) }
}

private enum AtlasExplorerMode: String, CaseIterable, Identifiable {
    case timeline, people, places
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

private extension AtlasEra {
    var shortTitle: String {
        switch self {
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
}

private extension AtlasHitKind {
    var title: String { rawValue.capitalized }
}

private struct AtlasEventDetailView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    let model: AtlasModel
    let eventID: String
    let openReference: (String) -> AnyView

    var body: some View {
        Group {
            if model.detailState.isLoading { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if case .failed(let message) = model.detailState { Text(message).foregroundStyle(theme.textSecondary).padding() }
            else if let event = model.selectedEvent, model.selectedEventID == eventID {
                ScrollView { VStack(alignment: .leading, spacing: Spacing.md) { Text(event.title).font(.custom(FontFamily.brand, size: 30)).foregroundStyle(theme.text);
Text("\(event.date?.label ?? event.yearLabel) · \(event.era.rawValue)").font(.system(size: 13)).foregroundStyle(theme.textMuted);
Text(event.summary).font(.system(size: 15)).foregroundStyle(theme.textSecondary).lineSpacing(4);
Text("IN SCRIPTURE").atlasSectionLabel(theme);
FlowLayout(items: event.refs, content: openReference);
if !event.people.isEmpty || !event.places.isEmpty { Text("WHO AND WHERE").atlasSectionLabel(theme);
entityChips(event.people + event.places, theme: theme) };
Button { app.chat.input = "Tell me about \(event.title) (\(event.yearLabel)) from the KJV.";
NotificationCenter.default.post(name: .openChatWithAttachment, object: nil) } label: { Text("✦ Ask about this").frame(maxWidth: .infinity, minHeight: 48) }.buttonStyle(AccentButtonStyle()) }.padding(.horizontal, Spacing.lg).padding(.bottom, Spacing.xl) }.background { MeshBackground() }
            } else { Text("That event is not in the atlas.").foregroundStyle(theme.textSecondary).padding() }
        }
        .navigationTitle("Event")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { model.loadEvent(eventID) }
    }

    private func entityChips(_ entities: [AtlasEntityRef], theme: SureWordColors) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)], alignment: .leading, spacing: Spacing.sm) {
            ForEach(entities) { entity in
                NavigationLink {
                    AtlasEntityDetailView(model: model, entityID: entity.id, openReference: openReference)
                } label: {
                    Text(entity.name)
                        .foregroundStyle(theme.textSecondary)
                        .padding(.horizontal, Spacing.md)
                        .frame(minHeight: 44)
                        .background(theme.surface, in: .capsule)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct AtlasEntityDetailView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    let model: AtlasModel
    let entityID: String
    let openReference: (String) -> AnyView

    var body: some View {
        Group {
            if model.detailState.isLoading { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if case .failed(let message) = model.detailState { Text(message).foregroundStyle(theme.textSecondary).padding() }
            else if let entity = model.selectedEntity, model.selectedEntityID == entityID {
                ScrollView { VStack(alignment: .leading, spacing: Spacing.sm) { Text(entity.name).font(.custom(FontFamily.brand, size: 30)).foregroundStyle(theme.text);
if let disambiguator = entity.disambiguator { Text(disambiguator).font(.system(size: 13)).foregroundStyle(theme.accent) };
Text(entity.kind == .person ? "Person" : "Place").font(.system(size: 13)).foregroundStyle(theme.textMuted);
GlassCard { Text(entity.description).font(.system(size: 15)).foregroundStyle(theme.textSecondary).lineSpacing(4);
Text("\(entity.refs.count) key \(entity.refs.count == 1 ? "verse" : "verses")").font(.system(size: 11.5)).foregroundStyle(theme.textGhost) };
Text("IN SCRIPTURE").atlasSectionLabel(theme);
FlowLayout(items: entity.refs, content: openReference);
if !entity.relationDetails.isEmpty { Text("CONNECTED TO").atlasSectionLabel(theme);
ForEach(entity.relationDetails, id: \.relation.id) { entry in relationRow(entry, theme: theme) } };
let typedConnectionIDs = Set(entity.relationDetails.map(\.entity.id));
let legacyConnections = entity.related.filter { !typedConnectionIDs.contains($0.id) };
if !legacyConnections.isEmpty { Text("OTHER RECORDED CONNECTIONS").atlasSectionLabel(theme);
ForEach(legacyConnections) { connection in NavigationLink { AtlasEntityDetailView(model: model, entityID: connection.id, openReference: openReference) } label: { HStack { Text(connection.name).foregroundStyle(theme.textSecondary);
Spacer();
Image(systemName: "chevron.right").foregroundStyle(theme.textFaint) }.padding(.horizontal, Spacing.md).frame(maxWidth: .infinity, minHeight: 44).background(theme.surface, in: .rect(cornerRadius: Radius.lg)).overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) } }.buttonStyle(.plain) } };
if !entity.events.isEmpty { Text("ON THE TIMELINE").atlasSectionLabel(theme);
ForEach(entity.events.prefix(5)) { event in NavigationLink { AtlasEventDetailView(model: model, eventID: event.id, openReference: openReference) } label: { eventRow(event, theme: theme) }.buttonStyle(.plain) };
if entity.events.count > 5 { NavigationLink { AtlasExplorerView(model: model, personID: entityID) } label: { Text("View all \(entity.events.count) events").frame(maxWidth: .infinity, minHeight: 44) }.buttonStyle(AccentButtonStyle()) } };
if entity.kind == .person { NavigationLink { AtlasFamilyView(model: model, entityID: entityID, openReference: openReference) } label: { Text("Immediate family").frame(maxWidth: .infinity, minHeight: 44) }.buttonStyle(AccentButtonStyle());
NavigationLink { AtlasTraceView(model: model, entityID: entityID, openReference: openReference) } label: { Text("Trace connection").frame(maxWidth: .infinity, minHeight: 44) }.buttonStyle(AccentButtonStyle()) };
Button { app.chat.input = entity.kind == .person ? "Who was \(entity.name) in the Bible, and what can I learn from them?" : "What happened at \(entity.name) in the Bible?";
NotificationCenter.default.post(name: .openChatWithAttachment, object: nil) } label: { Text("✦ Ask about this").frame(maxWidth: .infinity, minHeight: 48) }.buttonStyle(AccentButtonStyle()) }.padding(.horizontal, Spacing.lg).padding(.bottom, Spacing.xl) }.background { MeshBackground() }
            } else { Text("That entry is not in the Bible atlas.").foregroundStyle(theme.textSecondary).padding() }
        }
        .navigationTitle("Person or place")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { model.loadEntity(entityID) }
    }

    private func relationRow(_ entry: AtlasNeighborhoodEntry, theme: SureWordColors) -> some View { VStack(alignment: .leading, spacing: Spacing.sm) { NavigationLink { AtlasEntityDetailView(model: model, entityID: entry.entity.id, openReference: openReference) } label: { HStack { Text("\(entry.label): \(entry.entity.name)").foregroundStyle(theme.textSecondary);
Spacer();
Image(systemName: "chevron.right").foregroundStyle(theme.textFaint) }.frame(maxWidth: .infinity, minHeight: 44) }.buttonStyle(.plain);
Text(entry.relation.certainty.rawValue.capitalized).font(.system(size: 11.5)).foregroundStyle(theme.textGhost);
FlowLayout(items: entry.relation.refs, content: openReference) }.padding(Spacing.md).background(theme.surface, in: .rect(cornerRadius: Radius.lg)).overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) } }
    private func eventRow(_ event: AtlasEntityEventSummary, theme: SureWordColors) -> some View { HStack { Text(event.yearLabel).font(.system(size: 11.5, weight: .bold)).foregroundStyle(theme.accent).frame(width: 92, alignment: .leading);
VStack(alignment: .leading) { Text(event.title).foregroundStyle(theme.textSecondary);
Text(event.era.rawValue).font(.system(size: 11.5)).foregroundStyle(theme.textGhost) };
Spacer();
Image(systemName: "chevron.right").foregroundStyle(theme.textFaint) }.padding(Spacing.md).frame(maxWidth: .infinity, minHeight: 64, alignment: .leading).background(theme.surface, in: .rect(cornerRadius: Radius.lg)).overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1) } }
}

private struct AtlasFamilyView: View {
    @Environment(\.theme) private var theme
    let model: AtlasModel
    let entityID: String
    let openReference: (String) -> AnyView
    @State private var expandedRelationID: String?

    var body: some View {
        Group {
            if let entity = model.selectedEntity, model.selectedEntityID == entityID {
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(entity.name)
                            .font(.custom(FontFamily.brand, size: 30))
                            .foregroundStyle(theme.text)
                        Text("Immediate family · expand one branch at a time")
                            .font(.system(size: 13))
                            .foregroundStyle(theme.textMuted)

                        let family = entity.relationDetails.filter {
                            [AtlasRelationType.parent, .spouse, .sibling].contains($0.relation.type)
                        }
                        if family.isEmpty {
                            Text("No immediate family is recorded.")
                                .foregroundStyle(theme.textSecondary)
                                .padding(.vertical, Spacing.lg)
                        } else {
                            ForEach(family, id: \.relation.id) { entry in
                                VStack(alignment: .leading, spacing: Spacing.sm) {
                                    Button {
                                        expandedRelationID = expandedRelationID == entry.relation.id
                                            ? nil
                                            : entry.relation.id
                                    } label: {
                                        HStack {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text("\(entry.label): \(entry.entity.name)")
                                                    .font(.system(size: 15, weight: .bold))
                                                    .foregroundStyle(theme.text)
                                                if let disambiguator = entry.entity.disambiguator {
                                                    Text(disambiguator)
                                                        .font(.system(size: 11.5))
                                                        .foregroundStyle(theme.textMuted)
                                                }
                                            }
                                            Spacer()
                                            Image(
                                                systemName: expandedRelationID == entry.relation.id
                                                    ? "chevron.down"
                                                    : "chevron.right"
                                            )
                                            .foregroundStyle(theme.textFaint)
                                        }
                                        .frame(maxWidth: .infinity, minHeight: 48)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("\(entry.label), \(entry.entity.name)")

                                    if expandedRelationID == entry.relation.id {
                                        Text(entry.relation.certainty.rawValue.capitalized)
                                            .font(.system(size: 11.5))
                                            .foregroundStyle(theme.textGhost)
                                        FlowLayout(items: entry.relation.refs, content: openReference)
                                        NavigationLink {
                                            AtlasEntityDetailView(
                                                model: model,
                                                entityID: entry.entity.id,
                                                openReference: openReference
                                            )
                                        } label: {
                                            Text("Open \(entry.entity.name)")
                                                .frame(maxWidth: .infinity, minHeight: 44)
                                        }
                                        .buttonStyle(AccentButtonStyle())
                                    }
                                }
                                .padding(Spacing.md)
                                .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
                                .overlay {
                                    RoundedRectangle(cornerRadius: Radius.lg)
                                        .strokeBorder(theme.border, lineWidth: 1)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, Spacing.lg)
                    .padding(.bottom, Spacing.xl)
                }
                .background { MeshBackground() }
            } else if model.detailState.isLoading {
                ProgressView()
            } else {
                Text("No immediate family is recorded.")
                    .foregroundStyle(theme.textSecondary)
                    .padding()
            }
        }
        .navigationTitle("Immediate family")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { model.loadEntity(entityID) }
    }
}

private struct AtlasTraceView: View {
    @Environment(\.theme) private var theme
    let model: AtlasModel
    let entityID: String
    let openReference: (String) -> AnyView
    @State private var targetQuery = ""
    @State private var targetID: String?

    var body: some View { ScrollView { VStack(alignment: .leading, spacing: Spacing.sm) { Text("Trace connection").font(.custom(FontFamily.brand, size: 30)).foregroundStyle(theme.text);
Text("Find the shortest reviewed path from this person to another.").font(.system(size: 13)).foregroundStyle(theme.textMuted);
TextField("Search a person", text: Binding(get: { targetQuery }, set: { targetQuery = $0;
targetID = nil;
model.search($0) })).textInputAutocapitalization(.words).autocorrectionDisabled().padding(.horizontal, Spacing.md).frame(minHeight: 48).background(theme.surface, in: .capsule).overlay { Capsule().strokeBorder(theme.border, lineWidth: 1) }.accessibilityLabel("Search a person to trace");
if targetID == nil && !targetQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { ForEach(model.searchResults.filter { $0.kind == .person && $0.id != entityID }) { hit in Button { targetID = hit.id;
model.traceConnection(from: entityID, to: hit.id) } label: { HStack { Text(hit.name).foregroundStyle(theme.text);
Spacer();
Image(systemName: "chevron.right").foregroundStyle(theme.textFaint) }.padding(.horizontal, Spacing.lg).frame(maxWidth: .infinity, minHeight: 48).background(theme.surface, in: .rect(cornerRadius: Radius.lg)) }.buttonStyle(.plain).accessibilityLabel("Trace to \(hit.name)") } };
if let path = model.connectionPath, model.connectionState == .loaded { Text("SHORTEST CITED PATH").atlasSectionLabel(theme);
ForEach(Array(path.entities.enumerated()), id: \.element.id) { index, entity in NavigationLink { AtlasEntityDetailView(model: model, entityID: entity.id, openReference: openReference) } label: { Text(entity.name).foregroundStyle(theme.accent).frame(maxWidth: .infinity, alignment: .leading).padding(Spacing.md).frame(minHeight: 48).background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg)) }.buttonStyle(.plain);
if index < path.relations.count { let relation = path.relations[index];
Text(AtlasRelationLabels.label(for: relation, perspectiveID: entity.id)).font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.textSecondary);
Text(relation.certainty.rawValue.capitalized).font(.system(size: 11.5)).foregroundStyle(theme.textGhost);
FlowLayout(items: relation.refs, content: openReference) } } } else if targetID != nil && !model.connectionState.isLoading { Text("No reviewed connection was found between these people.").foregroundStyle(theme.textSecondary).padding(.vertical, Spacing.md) } }.padding(.horizontal, Spacing.lg).padding(.bottom, Spacing.xl) }.background { MeshBackground() }.navigationTitle("Trace connection").navigationBarTitleDisplayMode(.inline).onAppear { model.loadEntity(entityID) } }
}

private struct FlowLayout<Content: View>: View {
    let items: [String]
    let content: (String) -> Content
    var body: some View { LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)], alignment: .leading, spacing: Spacing.sm) { ForEach(items, id: \.self) { item in content(item) } } }
}

private extension View {
    func atlasSectionLabel(_ theme: SureWordColors) -> some View { font(.system(size: 11.5, weight: .bold)).kerning(1.1).foregroundStyle(theme.accentDim).padding(.top, Spacing.lg) }
}
