import Foundation

/// One era chip: the era and the short label it shows.
struct AtlasEraChip: Identifiable, Equatable, Sendable {
    let era: AtlasEra
    let label: String
    var id: AtlasEra { era }
}

/// Pure presentation rules for Timeline, People & Places: what an entry is
/// called, what the era chips say, the date and certainty wording, and the
/// prompts "Ask about this" puts in the chat box.
///
/// A line-for-line port of Android's `mobile/src/features/atlas/atlasView.ts`
/// (the source of truth). Copy here must stay verbatim with that file.
enum AtlasPresentation {
    /// Shared copy for the chronology disclaimer shown under the rail.
    static let ussherNote =
        "Dates follow the traditional Ussher chronology carried in the margins of the King James Bible. They are a reckoning from the genealogies of Scripture, not part of the text itself."

    /// The label above the chronology note.
    static let chronologyLabel = "CHRONOLOGY"

    /// The explorer's title when it is not scoped to a chapter or directory.
    static let explorerTitle = "Timeline, People & Places"

    // MARK: Kinds and eras

    static func hitKindLabel(_ kind: AtlasHitKind) -> String {
        switch kind {
        case .person: "Person"
        case .place: "Place"
        case .event: "Event"
        }
    }

    /// The plural section heading for a group of search hits.
    static func hitSectionLabel(_ kind: AtlasHitKind) -> String {
        switch kind {
        case .person: "People"
        case .place: "Places"
        case .event: "Events"
        }
    }

    /// The short form of an era for a chip, so nine fit across a phone.
    static func eraChipLabel(_ era: AtlasEra) -> String {
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

    /// Every era chip, in chronological order. Static, so the chips render
    /// before (or without) any timeline response.
    static func eraChips() -> [AtlasEraChip] {
        AtlasEra.allCases.map { AtlasEraChip(era: $0, label: eraChipLabel($0)) }
    }

    // MARK: Dates

    /// "c. 4004 BC · Creation & the Patriarchs"
    static func eventCaption(_ event: AtlasEventView) -> String {
        "\(eventDateLabel(event)) · \(event.era.rawValue)"
    }

    static func eventDateLabel(_ event: AtlasEventView) -> String {
        event.date?.label ?? event.yearLabel
    }

    static func eventDateProvenanceLabel(_ event: AtlasEventView) -> String {
        provenanceLabel(event.date?.provenance)
    }

    static func provenanceLabel(_ provenance: AtlasDateProvenance?) -> String {
        switch provenance {
        case .scriptureExplicit: "Scripture-explicit date"
        case .undated: "Date not given"
        default: "Traditional Ussher chronology"
        }
    }

    /// Search hits carry only the legacy label, so derive the same honest
    /// provenance the timeline shows.
    static func searchHitDateLabel(_ hit: AtlasSearchHit) -> String {
        guard let yearLabel = hit.yearLabel, !yearLabel.isEmpty else { return "" }
        let date = eventDate(fromLabel: yearLabel)
        switch date.provenance {
        case .undated: return "Date not given"
        case .scriptureExplicit: return date.label
        case .traditionalUssher: return "Traditional chronology · \(date.label)"
        }
    }

    /// Port of the core's `eventDateFromLabel`: an undated label invents no
    /// chronology, a numeric one is signed so BC sorts before AD.
    static func eventDate(fromLabel label: String) -> AtlasEventDate {
        let value = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = value.lowercased()
        let undated = normalized.range(
            of: #"\b(?:undated|unknown|not\s+given|n/a)\b"#,
            options: .regularExpression
        ) != nil
        if value.isEmpty || undated {
            return AtlasEventDate(label: value, startYear: nil, endYear: nil, provenance: .undated)
        }
        guard
            let regex = try? NSRegularExpression(
                pattern: #"(\d{1,5})(?:\s*(?:-|-|-|to)\s*(\d{1,5}))?\s*(bc|bce|ad|ce)?"#,
                options: [.caseInsensitive]
            ),
            let match = regex.firstMatch(
                in: normalized,
                range: NSRange(normalized.startIndex..., in: normalized)
            )
        else {
            return AtlasEventDate(label: value, startYear: nil, endYear: nil, provenance: .undated)
        }
        func group(_ index: Int) -> String? {
            let range = match.range(at: index)
            guard range.location != NSNotFound, let swiftRange = Range(range, in: normalized) else { return nil }
            return String(normalized[swiftRange])
        }
        let era = group(3)
        let sign = (era == "bc" || era == "bce") ? -1 : 1
        let start = sign * (Int(group(1) ?? "") ?? 0)
        let end = group(2).flatMap(Int.init).map { sign * $0 } ?? start
        return AtlasEventDate(label: value, startYear: start, endYear: end, provenance: .traditionalUssher)
    }

    // MARK: Relations

    static func relationTypeLabel(_ type: AtlasRelationType) -> String {
        switch type {
        case .parent: "Parent of"
        case .spouse: "Spouse of"
        case .sibling: "Sibling of"
        case .mentor: "Mentor of"
        case .disciple: "Disciple of"
        case .companion: "Companion of"
        case .associatedPlace: "Associated place"
        case .associated: "Associated with"
        }
    }

    /// Label an edge from the perspective of the entity being viewed.
    static func relationDisplayLabel(_ type: AtlasRelationType, direction: String) -> String {
        guard direction == "incoming" else { return relationTypeLabel(type) }
        switch type {
        case .parent: return "Child of"
        case .mentor: return "Student of"
        case .disciple: return "Mentor of"
        default: return relationTypeLabel(type)
        }
    }

    static func relationCertaintyLabel(_ certainty: AtlasRelationCertainty) -> String {
        switch certainty {
        case .explicit: "Scripture states"
        case .inferred: "Inferred"
        case .disputed: "Disputed"
        }
    }

    /// "Sibling Aaron" - the relation label followed by the other endpoint,
    /// exactly as Android's relation and family rows read.
    static func relationRowTitle(_ entry: AtlasNeighborhoodEntry) -> String {
        "\(entry.label) \(entry.entity.name)"
    }

    /// The immediate-family relation types, the same set as Android's
    /// family screen.
    static let familyRelationTypes: Set<AtlasRelationType> = [.parent, .spouse, .sibling]

    static func immediateFamily(_ entries: [AtlasNeighborhoodEntry]) -> [AtlasNeighborhoodEntry] {
        entries.filter { familyRelationTypes.contains($0.relation.type) }
    }

    // MARK: Entities

    /// The line under an entity's name: what it is, and where it sits.
    static func entitySubtitle(_ entity: AtlasEntityView) -> String {
        var parts = [entity.kind == .person ? "Person" : "Place"]
        if let era = entity.era { parts.append(era.rawValue) }
        if let region = entity.modernRegion, !region.isEmpty { parts.append(region) }
        return parts.joined(separator: " · ")
    }

    /// The meta line of a directory row: "Person · era" or "Place · region".
    static func entityRowMeta(_ entity: AtlasEntitySummary) -> String {
        let kind = entity.kind == .person ? "Person" : "Place"
        if let era = entity.era { return "\(kind) · \(era.rawValue)" }
        if let region = entity.modernRegion, !region.isEmpty { return "\(kind) · \(region)" }
        return kind
    }

    /// "Also called Abram" - or empty, when Scripture uses one name only.
    static func alsoCalledLine(_ entity: AtlasEntityView) -> String {
        entity.alsoCalled.isEmpty ? "" : "Also called \(entity.alsoCalled.joined(separator: ", "))"
    }

    /// "12 key verses · 3 events"
    static func entityCounts(_ entity: AtlasEntityView) -> String {
        var parts = ["\(entity.refs.count) key \(entity.refs.count == 1 ? "verse" : "verses")"]
        if !entity.events.isEmpty {
            parts.append("\(entity.events.count) \(entity.events.count == 1 ? "event" : "events")")
        }
        return parts.joined(separator: " · ")
    }

    /// The meta line of a search row: kind, date or era, first reference.
    static func searchRowMeta(_ hit: AtlasSearchHit) -> String {
        var line = hitKindLabel(hit.kind)
        if hit.yearLabel?.isEmpty == false {
            line += " · \(searchHitDateLabel(hit))"
        } else if let era = hit.era {
            line += " · \(era.rawValue)"
        }
        if let first = hit.refs.first { line += " · \(first)" }
        return line
    }

    /// The text on a reference chip that opens the reader.
    static func referenceChipLabel(_ reference: String) -> String {
        "\(reference) ›"
    }

    // MARK: Prompts

    static func askPrompt(for entity: AtlasEntityView) -> String {
        entity.kind == .person
            ? "Who was \(entity.name) in the Bible, and what can I learn from them?"
            : "What happened at \(entity.name) in the Bible?"
    }

    static func askPrompt(for event: AtlasEventView) -> String {
        "Tell me about \(event.title) (\(event.yearLabel)) from the KJV."
    }

    // MARK: Counts and empty states

    /// "12 events" / "1 event"
    static func eraEventCount(_ group: AtlasEraGroup) -> String {
        "\(group.events.count) \(group.events.count == 1 ? "event" : "events")"
    }

    /// The grouped search header, with the visible cap stated plainly.
    static func searchSummary(shown: Int, counts: AtlasSearchCounts) -> String {
        "\(shown) results shown · capped at 12 · \(counts.person) people · \(counts.place) places · \(counts.event) events"
    }

    /// What the timeline says when a filter finds nothing. The chapter case
    /// says which chapter rather than "no results".
    static func emptyTimelineMessage(book: String? = nil, chapter: Int? = nil, era: String? = nil) -> String {
        if let book, let chapter {
            return "The atlas has no events, people or places recorded in \(book) \(chapter)."
        }
        if let book { return "The atlas has no events recorded in \(book)." }
        if let era { return "No events on the timeline for \(era)." }
        return "No events on the timeline."
    }

    /// The People / Places directory when its filter matches nothing.
    static func emptyDirectoryMessage(_ kind: AtlasEntityKind) -> String {
        "No \(kind == .person ? "people" : "places") entries match this filter."
    }

    /// "Who's in this chapter" when the atlas names no one there.
    static func emptyChapterMessage(book: String, chapter: Int) -> String {
        "The atlas records no one and nowhere by name in \(book) \(chapter)."
    }

    static let invalidChapterMessage =
        "That is not a chapter of the Bible. Choose a book and chapter from the reader."
    static let entityNotFoundMessage =
        "That entry is not in the Bible atlas. Search for the name the King James Bible uses for them."
    static let eventNotFoundMessage = "That event is not in the Bible atlas."
    static let familyUnavailableMessage = "Immediate family is available for people in the atlas."
    static let familySubtitle = "One branch at a time · immediate family only"
    static let traceUnavailableMessage = "Trace is available between people in the atlas."
    static let traceSubtitle = "Search for another person to find the shortest cited connection."
    static let traceNoPathMessage = "No reviewed connection was found between these people."

    static func emptyFamilyMessage(_ name: String) -> String {
        "No immediate-family connections are recorded for \(name)."
    }

    static func traceHeading(_ name: String) -> String {
        "Trace from \(name)"
    }
}
