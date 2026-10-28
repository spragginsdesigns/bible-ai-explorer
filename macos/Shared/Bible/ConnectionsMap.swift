import Foundation
import SwiftUI

struct ConnectionsPlace: Equatable, Hashable, Sendable {
    let order: Int
    let chapter: Int
    let verse: Int?

    var reference: String {
        let chapterReference = "\(Bible.book(order: order)?.name ?? "") \(chapter)"
        return verse.map { "\(chapterReference):\($0)" } ?? chapterReference
    }

    static func validated(order: Int, chapter: Int, verse: Int?) -> Self? {
        guard let book = Bible.book(order: order), (1...book.chapters).contains(chapter),
              verse == nil || (verse ?? 0) > 0 else { return nil }
        return Self(order: order, chapter: chapter, verse: verse)
    }
}

struct ConnectionCanonSection: Identifiable, Sendable {
    let id: String
    let title: String
    let first: Int
    let last: Int
    let color: Color

    static let all: [Self] = [
        .init(id: "law", title: "Law", first: 1, last: 5, color: Color(red: 1, green: 0.36, blue: 0.54)),
        .init(id: "history", title: "History", first: 6, last: 17, color: .orange),
        .init(id: "poetry", title: "Poetry & Wisdom", first: 18, last: 22, color: .yellow),
        .init(id: "major", title: "Major Prophets", first: 23, last: 27, color: .pink),
        .init(id: "minor", title: "Minor Prophets", first: 28, last: 39, color: Color(red: 0.72, green: 0.8, blue: 0.23)),
        .init(id: "gospels", title: "Gospels", first: 40, last: 43, color: .teal),
        .init(id: "acts", title: "Acts", first: 44, last: 44, color: .green),
        .init(id: "pauline", title: "Pauline Epistles", first: 45, last: 57, color: .blue),
        .init(id: "general", title: "General Epistles", first: 58, last: 65, color: .cyan),
        .init(id: "revelation", title: "Revelation", first: 66, last: 66, color: .purple),
    ]
    static func containing(_ order: Int) -> Self { all.first { ($0.first...$0.last).contains(order) } ?? all[0] }
}

/// Pure rules behind the Connections screen, ported from Android's
/// `connections.tsx` and `features/bible/connectionsMap.ts` (the source of
/// truth), so the counts, the chapter stepping and the chat prompt read the
/// same on every client.
enum ConnectionsRules {
    /// The prompt "Keep studying this in chat" sends: Android's
    /// `connectionsAskPrompt`, naming at most ten of the linked passages so the
    /// answer walks through them. The verse itself rides as an attachment.
    static func askPrompt(reference: String, linked: [String]) -> String {
        let list = linked.prefix(10).joined(separator: ", ")
        return "How does \(reference) connect to \(list)? Walk me through what ties these passages together in the King James Bible."
    }

    /// How many links land in each canon section (`sectionCounts`), keyed by
    /// section id. A section with none is absent, not zero.
    static func sectionCounts(_ orders: [Int]) -> [String: Int] {
        orders.reduce(into: [:]) { counts, order in counts[ConnectionCanonSection.containing(order).id, default: 0] += 1 }
    }

    /// Links per verse of the chapter, for the whole-chapter verse list.
    static func countsByVerse(_ links: [[Int]]) -> [Int: Int] {
        links.reduce(into: [:]) { counts, link in
            if let verse = link.first { counts[verse, default: 0] += 1 }
        }
    }

    /// The previous or next chapter, crossing into the neighbouring book at
    /// either end (Genesis 50 -> Exodus 1, and back). Nil before Genesis 1 or
    /// after Revelation 22. Always the whole chapter.
    static func step(_ place: ConnectionsPlace, by delta: Int) -> ConnectionsPlace? {
        guard let book = Bible.book(order: place.order) else { return nil }
        var order = place.order
        var chapter = place.chapter + delta
        if chapter < 1 {
            order -= 1
            chapter = Bible.book(order: order)?.chapters ?? 1
        } else if chapter > book.chapters {
            order += 1
            chapter = 1
        }
        guard Bible.book(order: order) != nil else { return nil }
        return ConnectionsPlace(order: order, chapter: chapter, verse: nil)
    }

    /// The focused verse's empty list, in Android's words.
    static func emptyFocusMessage(loaded: Bool, sectionLabel: String?, focusCount: Int) -> String {
        if !loaded { return "Loading connected passages…" }
        if let sectionLabel, focusCount > 0 {
            return "No links into \(sectionLabel) from this verse. Tap All to see the other \(focusCount)."
        }
        return "No connected passages are listed for this verse."
    }

    /// "1 connection" / "12 connections", under the ring's title.
    static func connectionCount(_ count: Int) -> String {
        "\(count) \(count == 1 ? "connection" : "connections")"
    }

    /// A reference the explanation names, opened at its first verse:
    /// "Romans 5:8-10" opens Romans 5:8, as Android splits on the dash.
    static func explainedTarget(_ reference: String) -> ConnectionsPlace? {
        let head = reference.split(whereSeparator: { "-\u{2013}\u{2014}".contains($0) }).first.map(String.init) ?? reference
        guard let target = Bible.resolveReference(head) else { return nil }
        return ConnectionsPlace(order: target.order, chapter: target.chapter, verse: target.verse)
    }
}

struct ConnectionsChapter: Decodable, Sendable {
    let order: Int
    let chapter: Int
    let book: String
    let verseCount: Int
    let chapterStart: Int
    let total: Int
    let books: [[Int]]
    let links: [[Int]]

    func ranked(verse: Int?, section: String?) -> [[Int]] {
        links.filter {
            $0.count == 5 && (verse == nil || $0[0] == verse)
                && (section == nil || ConnectionCanonSection.containing($0[1]).id == section)
        }
    }
    var isValid: Bool {
        total > 0 && verseCount > 0 && books.allSatisfy { $0.count == 3 && $0[2] > 0 }
            && links.allSatisfy { $0.count == 5 && $0[0] > 0 && $0[0] <= verseCount && $0[4] >= 0 && $0[4] < total }
    }
}

struct ConnectionsOverview: Decodable, Sendable {
    let total: Int
    let bins: Int
    let books: [[Int]]
    let pairs: [[Int]]
}

enum ConnectionsGeometry {
    static let gap = 0.06
    static func angle(index: Double, total: Int) -> Double {
        -.pi / 2 + gap / 2 + ((index + 0.5) / Double(max(total, 1))) * (.pi * 2 - gap)
    }
    static func index(angle: Double, total: Int) -> Int? {
        guard total > 0 else { return nil }
        let circle = Double.pi * 2
        var offset = (angle - (-.pi / 2 + gap / 2)).truncatingRemainder(dividingBy: circle)
        if offset < 0 { offset += circle }
        guard offset <= circle - gap else { return nil }
        return min(total - 1, max(0, Int(offset / (circle - gap) * Double(total))))
    }
    static func book(index: Int, books: [[Int]]) -> Int? {
        books.first { $0.count == 3 && index >= $0[1] && index < $0[1] + $0[2] }?.first
    }
}

struct ConnectionExplanation: Equatable {
    struct Item: Equatable { let reference: String; var text: String }
    var summary = ""
    var items: [Item] = []

    static func parse(_ raw: String, complete: Bool) -> Self {
        var result = Self()
        let lines = raw.components(separatedBy: .newlines)
        for (index, line) in lines.enumerated() {
            var value = line.trimmingCharacters(in: .whitespaces)
            if let first = value.first, "-*•".contains(first) { value.removeFirst(); value = value.trimmingCharacters(in: .whitespaces) }
            guard !value.isEmpty else { continue }
            if let delimiter = value.range(of: "::"), delimiter.lowerBound != value.startIndex {
                result.items.append(Item(reference: String(value[..<delimiter.lowerBound]).replacingOccurrences(of: "*", with: "").trimmingCharacters(in: .whitespaces), text: String(value[delimiter.upperBound...]).trimmingCharacters(in: .whitespaces)))
            } else if !complete && !result.items.isEmpty && index == lines.count - 1 {
                continue
            } else if !result.items.isEmpty {
                result.items[result.items.count - 1].text += " " + value
            } else {
                result.summary += (result.summary.isEmpty ? "" : " ") + value
            }
        }
        return result
    }
}

@MainActor @Observable
final class ConnectionsModel {
    private(set) var chapter: ConnectionsChapter?
    private(set) var overview: ConnectionsOverview?
    private(set) var error: String?
    private(set) var loading = false
    private(set) var explanation = ""
    private(set) var explaining = false
    private(set) var explanationError: String?
    private var explainTask: Task<Void, Never>?
    private var runID = 0

    /// Android's `status === "done"`: the whole answer arrived. Only then is
    /// there something to keep studying in chat.
    var explanationFinished: Bool {
        !explaining && explanationError == nil
            && !explanation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func load(api: APIClient, place: ConnectionsPlace) async {
        loading = true
        error = nil
        if chapter?.order != place.order || chapter?.chapter != place.chapter { chapter = nil }
        do {
            let next = try await api.json("/api/bible/connections?book=\(place.order)&chapter=\(place.chapter)", as: ConnectionsChapter.self)
            try Task.checkCancellation()
            guard next.order == place.order, next.chapter == place.chapter, next.isValid else {
                throw APIError(message: "The connections response could not be read.")
            }
            chapter = next
        } catch {
            guard !Task.isCancelled else { return }
            self.error = (error as? APIError)?.message ?? "Connections could not be loaded. Try again."
        }
        loading = false
        if overview == nil {
            let next = try? await api.json("/api/bible/connections/overview", as: ConnectionsOverview.self)
            guard !Task.isCancelled else { return }
            if let next, next.total > 0, next.bins > 0, next.pairs.allSatisfy({ $0.count == 3 }) { overview = next }
        }
    }

    func resetExplanation() {
        runID += 1
        explainTask?.cancel()
        explainTask = nil
        explanation = ""
        explanationError = nil
        explaining = false
    }

    func explain(api: APIClient, place: ConnectionsPlace, translation: TranslationID, section: String?) {
        resetExplanation()
        guard place.verse != nil else { return }
        let id = runID
        explaining = true
        let body = ExplanationRequest(reference: place.reference, translation: translation.rawValue, section: section, modelId: SettingsStore.selectedChatModelId())
        explainTask = Task {
            guard await AIConsentGate.ensure(.tap) else {
                guard id == runID else { return }
                explaining = false
                explanationError = AIConsent.declinedNotice
                return
            }
            do {
                let bytes = try await api.stream("/api/bible/connections/explain", body: body)
                var full = ""
                var published = ContinuousClock.now
                for try await snapshot in VerseInsightModel.snapshots(from: bytes) {
                    guard id == runID else { return }
                    full = snapshot
                    if ContinuousClock.now - published >= .milliseconds(160) {
                        explanation = snapshot
                        published = .now
                    }
                }
                guard id == runID else { return }
                guard !full.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw APIError(message: "The model returned nothing. Try again.") }
                explanation = full
            } catch {
                guard id == runID, !Task.isCancelled else { return }
                explanationError = (error as? APIError)?.message ?? "These connections could not be explained. Try again."
            }
            explaining = false
        }
    }

    private struct ExplanationRequest: Encodable {
        let reference: String
        let translation: String
        let section: String?
        let modelId: String?
    }
}
