import Foundation

enum AtlasLoadState: Equatable {
    case idle
    case loading
    case loaded
    case empty
    case failed(String)

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}

enum AtlasAPI {
    static let defaultSearchLimit = 12

    /// URLComponents performs percent encoding for every query value, including
    /// spaces, ampersands, slashes, and non-ASCII names.
    static func path(_ endpoint: String, query: [URLQueryItem] = []) -> String {
        // Encoded by hand rather than through URLComponents.queryItems, which
        // leaves "/" (and a few other query-legal characters) bare; the shared
        // routes and the Android client always send the strict RFC 3986
        // unreserved set, so the two must match byte for byte.
        var unreserved = CharacterSet.alphanumerics
        unreserved.insert(charactersIn: "-._~")
        let pairs = query.map { item -> String in
            let name = item.name.addingPercentEncoding(withAllowedCharacters: unreserved) ?? item.name
            guard let value = item.value else { return name }
            let encoded = value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value
            return "\(name)=\(encoded)"
        }
        return pairs.isEmpty ? endpoint : "\(endpoint)?\(pairs.joined(separator: "&"))"
    }

    static func timeline(
        api: APIClient,
        era: AtlasEra? = nil,
        book: Int? = nil,
        chapter: Int? = nil,
        personID: String? = nil
    ) async throws -> AtlasTimelineResponse {
        var query: [URLQueryItem] = []
        if let era { query.append(URLQueryItem(name: "era", value: era.rawValue)) }
        if let book { query.append(URLQueryItem(name: "book", value: String(book))) }
        if let chapter { query.append(URLQueryItem(name: "chapter", value: String(chapter))) }
        if let personID { query.append(URLQueryItem(name: "personId", value: personID)) }
        return try await api.json(path("/api/bible/atlas/timeline", query: query), as: AtlasTimelineResponse.self)
    }

    static func entities(
        api: APIClient,
        kind: AtlasEntityKind,
        era: AtlasEra? = nil,
        cursor: String? = nil,
        limit: Int = 24
    ) async throws -> AtlasEntityListResponse {
        var query = [URLQueryItem(name: "kind", value: kind.rawValue), URLQueryItem(name: "limit", value: String(limit))]
        if let era { query.append(URLQueryItem(name: "era", value: era.rawValue)) }
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await api.json(path("/api/bible/atlas", query: query), as: AtlasEntityListResponse.self)
    }

    static func search(api: APIClient, query: String, limit: Int = defaultSearchLimit) async throws -> AtlasSearchResponse {
        try await api.json(
            path("/api/bible/atlas", query: [
                URLQueryItem(name: "q", value: query),
                URLQueryItem(name: "limit", value: String(limit)),
            ]),
            as: AtlasSearchResponse.self
        )
    }

    /// Who and where a chapter is about (`?book=&chapter=`), the same
    /// `whoIsInChapter` answer Android computes locally.
    static func chapter(api: APIClient, book: Int, chapter: Int) async throws -> AtlasChapterView {
        try await api.json(
            path("/api/bible/atlas", query: [
                URLQueryItem(name: "book", value: String(book)),
                URLQueryItem(name: "chapter", value: String(chapter)),
            ]),
            as: AtlasChapterView.self
        )
    }

    static func entity(api: APIClient, id: String) async throws -> AtlasEntityView {
        struct Response: Decodable { let entity: AtlasEntityView }
        return try await api.json(
            path("/api/bible/atlas", query: [URLQueryItem(name: "id", value: id)]),
            as: Response.self
        ).entity
    }

    static func event(api: APIClient, id: String) async throws -> AtlasEventView {
        struct Response: Decodable { let event: AtlasEventView }
        return try await api.json(
            path("/api/bible/atlas/event", query: [URLQueryItem(name: "id", value: id)]),
            as: Response.self
        ).event
    }

    static func connection(api: APIClient, from: String, to: String) async throws -> AtlasPersonConnectionPath {
        let response = try await api.json(
            path("/api/bible/atlas/connection", query: [
                URLQueryItem(name: "from", value: from),
                URLQueryItem(name: "to", value: to),
            ]),
            as: AtlasConnectionResponse.self
        )
        guard let path = response.path else {
            throw APIError(message: "The server sent no connection path.")
        }
        return path
    }
}

/// One shared atlas state machine for the macOS and iOS shells. The model owns
/// request cancellation and selection state so switching panes never discards
/// the current era, entity, event, or back-navigation context.
@MainActor
@Observable
final class AtlasModel {
    private(set) var allEras: [AtlasEra] = []
    private(set) var timelineGroups: [AtlasEraGroup] = []
    private(set) var timelineEvents: [AtlasEventView] = []
    private(set) var timelineState: AtlasLoadState = .idle

    private(set) var people: [AtlasEntitySummary] = []
    private(set) var places: [AtlasEntitySummary] = []
    private(set) var peopleState: AtlasLoadState = .idle
    private(set) var placesState: AtlasLoadState = .idle
    private(set) var peopleNextCursor: String?
    private(set) var placesNextCursor: String?

    private(set) var searchResults: [AtlasSearchHit] = []
    private(set) var searchCounts = AtlasSearchCounts(total: 0, person: 0, place: 0, event: 0)
    private(set) var searchState: AtlasLoadState = .idle
    var searchQuery = ""

    private(set) var selectedEntity: AtlasEntityView?
    private(set) var selectedEvent: AtlasEventView?
    private(set) var selectedEntityID: String?
    private(set) var selectedEventID: String?
    private(set) var detailState: AtlasLoadState = .idle
    private(set) var connectionPath: AtlasPersonConnectionPath?
    private(set) var connectionState: AtlasLoadState = .idle
    private(set) var lastError: APIError?

    /// True when the last entity/event load was a 404, so a shell can show
    /// Android's "not in the Bible atlas" copy rather than a retry card.
    /// `detailState` still reports `.failed`, which the macOS pane relies on.
    private(set) var detailNotFound = false
    /// True when the last trace answered 404: there is no reviewed path, which
    /// is an answer, not a retryable failure. `connectionState` stays `.failed`.
    private(set) var connectionNotFound = false

    /// What the current rail was loaded for (see `AtlasTimelineKey`).
    private(set) var timelineKey: AtlasTimelineKey?
    /// The era the current people / places directory was loaded with, so
    /// "Load more" and retry keep the filter.
    private(set) var peopleEra: AtlasEra?
    private(set) var placesEra: AtlasEra?

    /// "Who's in this chapter", from `/api/bible/atlas?book=&chapter=`.
    private(set) var chapterView: AtlasChapterView?
    private(set) var chapterState: AtlasLoadState = .idle
    private(set) var chapterBook: Int?
    private(set) var chapterNumber: Int?

    /// Trace's own person search. Kept apart from `searchQuery` so tracing
    /// never rewrites the explorer's search box.
    private(set) var traceQuery = ""
    private(set) var traceResults: [AtlasSearchHit] = []
    private(set) var traceSearchState: AtlasLoadState = .idle

    /// These remain set while a request is in flight, allowing a shell to
    /// dismiss a detail sheet and return to the same directory/timeline.
    var selectedEra: AtlasEra?
    private(set) var journeyPersonID: String?

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private var timelineTask: Task<Void, Never>?
    @ObservationIgnored private var peopleTask: Task<Void, Never>?
    @ObservationIgnored private var placesTask: Task<Void, Never>?
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var detailTask: Task<Void, Never>?
    @ObservationIgnored private var connectionTask: Task<Void, Never>?
    @ObservationIgnored private var chapterTask: Task<Void, Never>?
    @ObservationIgnored private var traceSearchTask: Task<Void, Never>?

    init(api: APIClient) {
        self.api = api
    }

    func loadTimeline(
        era: AtlasEra? = nil,
        book: Int? = nil,
        chapter: Int? = nil,
        personID: String? = nil
    ) {
        selectedEra = era
        journeyPersonID = personID
        timelineKey = AtlasTimelineKey(era: era, book: book, chapter: chapter, personID: personID)
        timelineTask?.cancel()
        timelineState = .loading
        lastError = nil
        let api = api
        timelineTask = Task { @MainActor in
            do {
                let response = try await AtlasAPI.timeline(
                    api: api,
                    era: era,
                    book: book,
                    chapter: chapter,
                    personID: personID
                )
                guard !Task.isCancelled else { return }
                allEras = response.allEras
                timelineGroups = response.groups
                timelineEvents = response.events
                timelineState = response.events.isEmpty ? .empty : .loaded
            } catch {
                guard !Task.isCancelled else { return }
                fail(&timelineState, error: error, fallback: "The atlas timeline could not be loaded.")
            }
        }
    }

    func loadPersonJourney(_ personID: String) {
        clearSearch()
        loadTimeline(era: nil, personID: personID)
    }

    func loadEntities(
        kind: AtlasEntityKind,
        era: AtlasEra? = nil,
        cursor: String? = nil,
        limit: Int = 24,
        allPages: Bool = false
    ) {
        if cursor == nil {
            switch kind {
            case .person: peopleEra = era
            case .place: placesEra = era
            }
        }
        let task = Task { @MainActor in
            do {
                var response = try await AtlasAPI.entities(api: api, kind: kind, era: era, cursor: cursor, limit: limit)
                var results = response.results
                // Android's directory shows every bundled entry, not a first
                // page, so `allPages` keeps reading until the cursor runs out.
                while allPages, let next = response.nextCursor, !Task.isCancelled {
                    response = try await AtlasAPI.entities(api: api, kind: kind, era: era, cursor: next, limit: limit)
                    results += response.results
                }
                guard !Task.isCancelled else { return }
                let isEmptyPage = results.isEmpty && cursor == nil
                switch kind {
                case .person:
                    people = cursor == nil ? results : people + results
                    peopleNextCursor = response.nextCursor
                    peopleState = isEmptyPage ? .empty : .loaded
                case .place:
                    places = cursor == nil ? results : places + results
                    placesNextCursor = response.nextCursor
                    placesState = isEmptyPage ? .empty : .loaded
                }
                lastError = nil
            } catch {
                guard !Task.isCancelled else { return }
                switch kind {
                case .person: fail(&peopleState, error: error, fallback: "People could not be loaded.")
                case .place: fail(&placesState, error: error, fallback: "Places could not be loaded.")
                }
            }
        }
        switch kind {
        case .person:
            peopleTask?.cancel()
            peopleState = .loading
            peopleTask = task
        case .place:
            placesTask?.cancel()
            placesState = .loading
            placesTask = task
        }
    }

    /// The next page of a directory, with the era it was first loaded with.
    func loadMoreEntities(kind: AtlasEntityKind, limit: Int = 100) {
        switch kind {
        case .person:
            guard let cursor = peopleNextCursor else { return }
            loadEntities(kind: kind, era: peopleEra, cursor: cursor, limit: limit)
        case .place:
            guard let cursor = placesNextCursor else { return }
            loadEntities(kind: kind, era: placesEra, cursor: cursor, limit: limit)
        }
    }

    /// Reload a directory from the top, keeping its era filter.
    func reloadEntities(kind: AtlasEntityKind) {
        loadEntities(
            kind: kind,
            era: kind == .person ? peopleEra : placesEra,
            limit: 100,
            allPages: true
        )
    }

    func loadChapter(book: Int, chapter: Int) {
        chapterTask?.cancel()
        chapterBook = book
        chapterNumber = chapter
        chapterView = nil
        chapterState = .loading
        let api = api
        chapterTask = Task { @MainActor in
            do {
                let view = try await AtlasAPI.chapter(api: api, book: book, chapter: chapter)
                guard !Task.isCancelled else { return }
                chapterView = view
                chapterState = view.entities.isEmpty ? .empty : .loaded
            } catch {
                guard !Task.isCancelled else { return }
                let apiError = error as? APIError ?? APIError(message: "Who's in this chapter could not be loaded.")
                chapterState = .failed(apiError.message)
            }
        }
    }

    /// People-only search for Trace. The server ranks every kind together and
    /// caps a page at 25, so the widest page is filtered to people and then
    /// held to Android's twelve.
    func searchTracePeople(_ query: String, excluding fromID: String, delay: Duration = .milliseconds(220)) {
        traceQuery = query
        traceSearchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            traceResults = []
            traceSearchState = .idle
            return
        }
        traceSearchState = .loading
        let api = api
        traceSearchTask = Task { @MainActor in
            do {
                try await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
                let response = try await AtlasAPI.search(api: api, query: trimmed, limit: 25)
                guard !Task.isCancelled, traceQuery == query else { return }
                traceResults = Array(
                    response.results.filter { $0.kind == .person && $0.id != fromID }.prefix(AtlasAPI.defaultSearchLimit)
                )
                traceSearchState = traceResults.isEmpty ? .empty : .loaded
            } catch {
                guard !Task.isCancelled else { return }
                let apiError = error as? APIError ?? APIError(message: "Atlas search failed.")
                traceSearchState = .failed(apiError.message)
            }
        }
    }

    /// Forget any trace: its query, candidates and path. Called when a trace
    /// screen opens so a previous person's path is never shown.
    func resetTrace() {
        traceSearchTask?.cancel()
        connectionTask?.cancel()
        traceQuery = ""
        traceResults = []
        traceSearchState = .idle
        connectionPath = nil
        connectionNotFound = false
        connectionState = .idle
    }

    /// Debounced server search. A new query cancels both the timer and the
    /// previous request, so stale results cannot replace the current query.
    func search(_ query: String, delay: Duration = .milliseconds(220)) {
        searchQuery = query
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            searchResults = []
            searchCounts = AtlasSearchCounts(total: 0, person: 0, place: 0, event: 0)
            searchState = .empty
            return
        }
        searchState = .loading
        lastError = nil
        let api = api
        searchTask = Task { @MainActor in
            do {
                try await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
                let response = try await AtlasAPI.search(api: api, query: trimmed)
                guard !Task.isCancelled, searchQuery == query else { return }
                searchResults = response.results
                searchCounts = response.counts
                searchState = response.results.isEmpty ? .empty : .loaded
            } catch {
                guard !Task.isCancelled else { return }
                fail(&searchState, error: error, fallback: "Atlas search failed.")
            }
        }
    }

    func clearSearch() {
        searchTask?.cancel()
        searchQuery = ""
        searchResults = []
        searchCounts = AtlasSearchCounts(total: 0, person: 0, place: 0, event: 0)
        searchState = .idle
    }

    func loadEntity(_ id: String) {
        detailTask?.cancel()
        selectedEntityID = id
        selectedEventID = nil
        detailState = .loading
        detailNotFound = false
        lastError = nil
        let api = api
        detailTask = Task { @MainActor in
            do {
                let entity = try await AtlasAPI.entity(api: api, id: id)
                guard !Task.isCancelled else { return }
                selectedEntity = entity
                selectedEvent = nil
                lastError = nil
                detailState = .loaded
            } catch {
                guard !Task.isCancelled else { return }
                detailNotFound = (error as? APIError)?.status == 404
                fail(&detailState, error: error, fallback: "That atlas entry could not be loaded.")
            }
        }
    }

    func loadEvent(_ id: String) {
        detailTask?.cancel()
        selectedEventID = id
        selectedEntityID = nil
        detailState = .loading
        detailNotFound = false
        lastError = nil
        let api = api
        detailTask = Task { @MainActor in
            do {
                let event = try await AtlasAPI.event(api: api, id: id)
                guard !Task.isCancelled else { return }
                selectedEvent = event
                selectedEntity = nil
                lastError = nil
                detailState = .loaded
            } catch {
                guard !Task.isCancelled else { return }
                detailNotFound = (error as? APIError)?.status == 404
                fail(&detailState, error: error, fallback: "That atlas event could not be loaded.")
            }
        }
    }

    func traceConnection(from: String, to: String) {
        connectionTask?.cancel()
        connectionState = .loading
        // A new target must never show the previous target's path.
        connectionPath = nil
        connectionNotFound = false
        lastError = nil
        let api = api
        connectionTask = Task { @MainActor in
            do {
                let path = try await AtlasAPI.connection(api: api, from: from, to: to)
                guard !Task.isCancelled else { return }
                connectionPath = path
                lastError = nil
                connectionState = path.ids.isEmpty ? .empty : .loaded
            } catch {
                guard !Task.isCancelled else { return }
                connectionNotFound = (error as? APIError)?.status == 404
                fail(&connectionState, error: error, fallback: "No reviewed connection was found.")
            }
        }
    }

    func dismissDetail() {
        detailTask?.cancel()
        selectedEntity = nil
        selectedEvent = nil
        detailState = .idle
    }

    private func fail(_ state: inout AtlasLoadState, error: Error, fallback: String) {
        let apiError = error as? APIError ?? APIError(message: error.localizedDescription.isEmpty ? fallback : error.localizedDescription)
        lastError = apiError
        state = .failed(apiError.message)
    }
}
