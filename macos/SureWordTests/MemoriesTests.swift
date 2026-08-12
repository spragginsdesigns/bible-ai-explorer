import Foundation
import Testing
@testable import SureWord

/// Ported one-for-one from `mobile/src/features/memories/utils.test.ts` so the
/// Mac client's grouping is pinned to the Android/web behaviour rather than
/// re-derived. If a case here changes, the TS suite must change with it.
@Suite("Memory grouping")
struct MemoryGroupingTests {

    private func memory(_ id: String, _ category: String) -> MemoryRecord {
        MemoryRecord(
            id: id,
            content: "memory \(id)",
            category: category,
            updatedAt: "2026-08-10T00:00:00Z"
        )
    }

    @Test("Labels every canonical category")
    func labelsEveryCategory() {
        #expect(MemoryCategory.labels["profile"] == "Profile")
        #expect(MemoryCategory.labels["prayer"] == "Prayer requests")
        #expect(MemoryCategory.labels["study"] == "Study")
        #expect(MemoryCategory.labels["preference"] == "Preferences")
        #expect(MemoryCategory.labels["general"] == "General")
    }

    @Test("Returns nothing when there is nothing to group")
    func groupsEmpty() {
        #expect(MemoryCategory.group([]).isEmpty)
    }

    @Test("Orders groups by the canonical category order, not input order")
    func ordersByCanonicalOrder() {
        let groups = MemoryCategory.group([
            memory("1", "general"),
            memory("2", "study"),
            memory("3", "profile"),
        ])
        #expect(groups.map(\.category) == ["profile", "study", "general"])
    }

    @Test("Keeps every memory inside its category bucket")
    func keepsMembership() {
        let groups = MemoryCategory.group([
            memory("1", "prayer"),
            memory("2", "prayer"),
            memory("3", "profile"),
        ])
        #expect(groups[0].category == "profile")
        #expect(groups[0].items.map(\.id) == ["3"])
        #expect(groups[1].category == "prayer")
        #expect(groups[1].items.map(\.id) == ["1", "2"])
    }

    @Test("Omits categories with no memories")
    func omitsEmptyCategories() {
        #expect(MemoryCategory.group([memory("1", "study")]).map(\.category) == ["study"])
    }

    @Test("Attaches the display label to each group")
    func attachesLabel() {
        #expect(MemoryCategory.group([memory("1", "prayer")])[0].label == "Prayer requests")
    }

    @Test("Folds unknown categories into General")
    func foldsUnknownCategories() {
        let groups = MemoryCategory.group([
            memory("1", "health"),
            memory("2", "general"),
        ])
        #expect(groups.count == 1)
        #expect(groups[0].category == "general")
        #expect(groups[0].items.map(\.id) == ["1", "2"])
    }
}

/// Matches `relativeTime` in `mobile/src/features/notes/utils.ts`, which the
/// Android memory screen uses for the summary's "Updated …" line.
@Suite("Memory timestamps")
struct MemoryFormatTests {
    private let now = Date(timeIntervalSince1970: 1_786_000_000)  // 2026-08-06 UTC

    private func iso(minusSeconds seconds: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: now.addingTimeInterval(-seconds))
    }

    @Test("Reads both fractional and whole-second ISO timestamps")
    func parsesBothISOShapes() {
        #expect(MemoryFormat.date(fromISO: "2026-08-10T00:00:00Z") != nil)
        #expect(MemoryFormat.date(fromISO: "2026-08-10T00:00:00.123Z") != nil)
        #expect(MemoryFormat.date(fromISO: "not a date") == nil)
    }

    @Test("Empty string for an unparseable timestamp")
    func emptyForGarbage() {
        #expect(MemoryFormat.relativeTime("nonsense", now: now).isEmpty)
    }

    @Test("Buckets by minute, hour and day like the TS original")
    func buckets() {
        #expect(MemoryFormat.relativeTime(iso(minusSeconds: 30), now: now) == "Just now")
        #expect(MemoryFormat.relativeTime(iso(minusSeconds: 5 * 60), now: now) == "5m ago")
        #expect(MemoryFormat.relativeTime(iso(minusSeconds: 3 * 3600), now: now) == "3h ago")
        #expect(MemoryFormat.relativeTime(iso(minusSeconds: 2 * 86_400), now: now) == "2d ago")
    }

    @Test("Falls back to a calendar date beyond a week")
    func calendarDateBeyondAWeek() {
        let label = MemoryFormat.relativeTime(iso(minusSeconds: 30 * 86_400), now: now)
        #expect(!label.hasSuffix("ago"))
        #expect(!label.isEmpty)
    }
}

/// The wire contracts of `src/app/api/memories/*`. These shapes are what the
/// three clients agree on; a rename on the server has to break a test here.
@Suite("Memory API payloads")
struct MemoryPayloadTests {

    @Test("Decodes GET /api/memories")
    func decodesList() throws {
        let json = """
        {"enabled":true,"memories":[
          {"id":"m1","content":"Prays for his brother","category":"prayer",
           "updatedAt":"2026-08-11T04:05:06.789Z"}
        ]}
        """
        let response = try JSONDecoder().decode(MemoriesResponse.self, from: Data(json.utf8))
        #expect(response.enabled)
        #expect(response.memories.count == 1)
        #expect(response.memories[0].category == "prayer")
    }

    @Test("Decodes POST /api/memories/summary with a summary")
    func decodesSummary() throws {
        let json = """
        {"summary":{"overview":"You are…","sections":[{"title":"Faith","content":"You…"}]},
         "generatedAt":"2026-08-11T04:05:06.789Z"}
        """
        let response = try JSONDecoder().decode(MemorySummaryResponse.self, from: Data(json.utf8))
        #expect(response.summary?.overview == "You are…")
        #expect(response.summary?.sections.first?.title == "Faith")
        #expect(response.generatedAt != nil)
    }

    @Test("Decodes the empty summary the server sends with no memories")
    func decodesEmptySummary() throws {
        let json = #"{"summary":null,"generatedAt":null}"#
        let response = try JSONDecoder().decode(MemorySummaryResponse.self, from: Data(json.utf8))
        #expect(response.summary == nil)
        #expect(response.generatedAt == nil)
    }

    @Test("Caps match src/lib/memory.ts")
    func caps() {
        #expect(MemoryLimits.maxPerUser == 60)
        #expect(MemoryLimits.maxContentLength == 500)
    }
}

@Suite("Memories model")
@MainActor
struct MemoriesModelTests {

    @Test("Summary button asks to generate until a summary exists")
    func summaryButtonLabel() {
        let model = MemoriesModel()
        #expect(model.summaryButtonLabel == "Generate summary")
        #expect(model.summaryState == .idle)
    }

    @Test("Add is blocked until there is non-blank text")
    func addGating() {
        let model = MemoriesModel()
        #expect(!model.canAdd)
        model.draft = "   "
        #expect(!model.canAdd)
        model.draft = "Remember that I read the KJV"
        #expect(model.canAdd)
    }

    @Test("Nothing is requested before a client is configured")
    func noApiIsANoOp() async {
        let model = MemoriesModel()
        await model.load()
        await model.generateSummary()
        #expect(model.memories.isEmpty)
        #expect(model.isEnabled == nil)
        #expect(model.summaryState == .idle)
        #expect(!model.hasLoaded)
    }
}
