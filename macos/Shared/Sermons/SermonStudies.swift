import Foundation

/// Sermon studies from the user's own church - the Apple port of
/// `mobile/src/features/sermons/sermonApi.ts`, which mirrors
/// `src/lib/sermon-studies.ts`.
///
/// The server owns everything: which studies this account may see (the
/// YouTube channel on their `UserChurch`), how they are built, and what a
/// section holds. This is the shape the screens render and nothing more.
/// Decoding is lenient field by field so one odd section never takes a whole
/// study down.

struct SermonPassageVerse: Decodable, Sendable, Equatable, Identifiable {
    let verse: Int
    let text: String
    var id: Int { verse }
}

struct SermonSection: Decodable, Sendable, Equatable {
    let heading: String
    let startMs: Int
    /// Verbatim from the recording, or nil when nothing quotable was verified.
    let pastorQuote: String?
    let passage: String?
    let passageText: [SermonPassageVerse]?
    /// SureWord's own teaching, always labelled as such on screen.
    let explanation: String
    let reflection: String
    let imageUrl: String?

    private enum CodingKeys: String, CodingKey {
        case heading, startMs, pastorQuote, passage, passageText, explanation, reflection, imageUrl
    }

    init(
        heading: String,
        startMs: Int,
        pastorQuote: String? = nil,
        passage: String? = nil,
        passageText: [SermonPassageVerse]? = nil,
        explanation: String = "",
        reflection: String = "",
        imageUrl: String? = nil
    ) {
        self.heading = heading
        self.startMs = startMs
        self.pastorQuote = pastorQuote
        self.passage = passage
        self.passageText = passageText
        self.explanation = explanation
        self.reflection = reflection
        self.imageUrl = imageUrl
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        heading = (try? c.decode(String.self, forKey: .heading)) ?? ""
        startMs = (try? c.decode(Int.self, forKey: .startMs))
            ?? Int((try? c.decode(Double.self, forKey: .startMs)) ?? 0)
        pastorQuote = try? c.decodeIfPresent(String.self, forKey: .pastorQuote)
        passage = try? c.decodeIfPresent(String.self, forKey: .passage)
        passageText = try? c.decodeIfPresent([SermonPassageVerse].self, forKey: .passageText)
        explanation = (try? c.decode(String.self, forKey: .explanation)) ?? ""
        reflection = (try? c.decode(String.self, forKey: .reflection)) ?? ""
        imageUrl = try? c.decodeIfPresent(String.self, forKey: .imageUrl)
    }
}

struct SermonStudySummary: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let videoId: String
    let title: String
    let serviceTitle: String
    let serviceDate: String?
    let preacher: String?
    let preachingText: String?
    let bigIdea: String
    let imageUrl: String?
}

struct SermonStudyDetail: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let videoId: String
    let title: String
    let serviceTitle: String
    let serviceDate: String?
    let preacher: String?
    let preachingText: String?
    let bigIdea: String
    let imageUrl: String?
    let summary: String
    let application: String
    let prayer: String
    let sections: [SermonSection]
    let sermonStartMs: Int?
    let durationSec: Int?

    private enum CodingKeys: String, CodingKey {
        case id, videoId, title, serviceTitle, serviceDate, preacher, preachingText, bigIdea, imageUrl
        case summary, application, prayer, sections, sermonStartMs, durationSec
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        videoId = try c.decode(String.self, forKey: .videoId)
        title = (try? c.decode(String.self, forKey: .title)) ?? "Sermon study"
        serviceTitle = (try? c.decode(String.self, forKey: .serviceTitle)) ?? ""
        serviceDate = try? c.decodeIfPresent(String.self, forKey: .serviceDate)
        preacher = try? c.decodeIfPresent(String.self, forKey: .preacher)
        preachingText = try? c.decodeIfPresent(String.self, forKey: .preachingText)
        bigIdea = (try? c.decode(String.self, forKey: .bigIdea)) ?? ""
        imageUrl = try? c.decodeIfPresent(String.self, forKey: .imageUrl)
        summary = (try? c.decode(String.self, forKey: .summary)) ?? ""
        application = (try? c.decode(String.self, forKey: .application)) ?? ""
        prayer = (try? c.decode(String.self, forKey: .prayer)) ?? ""
        sections = (try? c.decode([SermonSection].self, forKey: .sections)) ?? []
        sermonStartMs = Self.whole(c, .sermonStartMs)
        durationSec = Self.whole(c, .durationSec)
    }

    /// A JSON number that may arrive as 1867000 or 1867000.0; nil when absent.
    private static func whole(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> Int? {
        if let value = try? c.decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? c.decodeIfPresent(Double.self, forKey: key) { return Int(value) }
        return nil
    }

    /// "Sunday Morning Worship · Pastor Ron Hess · 2026-09-13" - the credits
    /// line, raw date included, exactly as Android joins it.
    var credits: String {
        [serviceTitle, preacher ?? "", serviceDate ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// The church's own app, where the exact time of an unconfirmed event lives.
struct ChurchApp: Decodable, Sendable, Equatable {
    let name: String
    let androidUrl: String
    let iosUrl: String
}

/// A gathering announced from the pulpit - `ChurchEventView` in
/// `src/lib/church-events-rules.ts`. The server builds every label and link;
/// `calendarNotes`, `calendarEndsAt` and `calendarLocation` fill the Apple
/// Calendar sheet, so it says exactly what the Google link and the .ics say.
struct ChurchEvent: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let title: String
    let details: String?
    let audience: String?
    let location: String?
    let startsAt: String
    let allDay: Bool
    let timeZone: String
    let when: String
    /// False when the recording left the time unclear; the card then says so
    /// and points at the church's app.
    let certain: Bool
    let sourceQuote: String
    let sourceUrl: String
    let googleCalendarUrl: String
    let calendarNotes: String
    let calendarEndsAt: String?
    let calendarLocation: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, details, audience, location, startsAt, allDay, timeZone, when
        case certain, sourceQuote, sourceUrl, googleCalendarUrl, calendarNotes, calendarEndsAt, calendarLocation
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        details = try? c.decodeIfPresent(String.self, forKey: .details)
        audience = try? c.decodeIfPresent(String.self, forKey: .audience)
        location = try? c.decodeIfPresent(String.self, forKey: .location)
        startsAt = try c.decode(String.self, forKey: .startsAt)
        allDay = (try? c.decode(Bool.self, forKey: .allDay)) ?? false
        timeZone = (try? c.decode(String.self, forKey: .timeZone)) ?? "America/Los_Angeles"
        when = (try? c.decode(String.self, forKey: .when)) ?? ""
        // An event that cannot say whether it is sure is treated as unsure.
        certain = (try? c.decode(Bool.self, forKey: .certain)) ?? false
        sourceQuote = (try? c.decode(String.self, forKey: .sourceQuote)) ?? ""
        sourceUrl = (try? c.decode(String.self, forKey: .sourceUrl)) ?? ""
        googleCalendarUrl = (try? c.decode(String.self, forKey: .googleCalendarUrl)) ?? ""
        calendarNotes = (try? c.decode(String.self, forKey: .calendarNotes)) ?? ""
        calendarEndsAt = try? c.decodeIfPresent(String.self, forKey: .calendarEndsAt)
        calendarLocation = try? c.decodeIfPresent(String.self, forKey: .calendarLocation)
    }

    var startDate: Date? { LearnTime.parse(startsAt) }
    var calendarEndDate: Date? { calendarEndsAt.flatMap(LearnTime.parse) }

    /// "Ministry hall · For ladies" - the line under the time.
    var meta: String {
        [location, audience.map { "For \($0)" }].compactMap { $0 }.joined(separator: " · ")
    }
}

/// The studies list with the events announced across them.
struct SermonHome: Sendable, Equatable {
    var studies: [SermonStudySummary]
    var events: [ChurchEvent]
    var churchApp: ChurchApp?
}

/// One study with the events announced at that service.
struct SermonStudyPage: Sendable, Equatable {
    var study: SermonStudyDetail
    var events: [ChurchEvent]
    var churchApp: ChurchApp?
}

enum SermonStudiesAPI {
    private struct ListResponse: Decodable {
        let studies: [SermonStudySummary]?
        let events: LenientList<ChurchEvent>?
        let churchApp: ChurchApp?
    }

    private struct DetailResponse: Decodable {
        let study: SermonStudyDetail
        let events: LenientList<ChurchEvent>?
        let churchApp: ChurchApp?
    }

    static func home(api: APIClient) async throws -> SermonHome {
        let response = try await api.json("/api/sermon-studies", as: ListResponse.self)
        return SermonHome(
            studies: response.studies ?? [],
            events: response.events?.items ?? [],
            churchApp: response.churchApp
        )
    }

    static func list(api: APIClient) async throws -> [SermonStudySummary] {
        try await home(api: api).studies
    }

    static func page(api: APIClient, id: String) async throws -> SermonStudyPage {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
        let response = try await api.json("/api/sermon-studies/\(escaped)", as: DetailResponse.self)
        return SermonStudyPage(
            study: response.study,
            events: response.events?.items ?? [],
            churchApp: response.churchApp
        )
    }

    static func study(api: APIClient, id: String) async throws -> SermonStudyDetail {
        try await page(api: api, id: id).study
    }
}

/// An array decoded element by element, dropping any that fail, so one odd
/// event never hides the studies around it.
struct LenientList<Element: Decodable>: Decodable {
    let items: [Element]

    /// Reads nothing, so it succeeds on any value (null and strings included)
    /// and the container always moves past a bad element.
    private struct Skip: Decodable {
        init(from decoder: any Decoder) throws {}
    }

    init(from decoder: any Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var items: [Element] = []
        while !container.isAtEnd {
            if let item = try? container.decode(Element.self) {
                items.append(item)
            } else {
                _ = try? container.decode(Skip.self)
            }
        }
        self.items = items
    }
}

enum SermonFormat {
    /// Deep link into the recording, at a moment when one is given.
    static func watchURL(videoID: String, atMs: Int? = nil) -> URL? {
        var text = "https://www.youtube.com/watch?v=\(videoID)"
        if let atMs { text += "&t=\(Int((Double(atMs) / 1000).rounded(.down)))s" }
        return URL(string: text)
    }

    /// "31:07", or "1:02:05" past the hour.
    static func timestamp(_ ms: Int) -> String {
        let total = max(0, Int((Double(ms) / 1000).rounded(.toNearestOrAwayFromZero)))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = String(format: "%02d", total % 60)
        return hours > 0
            ? "\(hours):\(String(format: "%02d", minutes)):\(seconds)"
            : "\(minutes):\(seconds)"
    }

    /// "Sunday, September 13" for a `YYYY-MM-DD` service date, or nil.
    static func serviceDate(_ date: String?, locale: Locale = .current) -> String? {
        guard let date, let noon = LearnTime.parse("\(date)T12:00:00Z") else { return nil }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.setLocalizedDateFormatFromTemplate("EEEEMMMMd")
        return formatter.string(from: noon)
    }

    /// The Ask AI prefill: an ordinary sentence naming the study. The assistant
    /// reads the study itself with its `getSermonStudy` tool, so nothing hidden
    /// rides along.
    static func askPrompt(title: String) -> String {
        "Let's talk about the sermon study \"\(title)\"."
    }
}
