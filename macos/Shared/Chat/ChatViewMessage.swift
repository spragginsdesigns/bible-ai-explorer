import Foundation

// MARK: - Card payloads

struct RetrievedVerse: Sendable, Equatable, Identifiable {
    var reference: String
    var similarity: Double
    var text: String?

    var id: String { "\(reference)-\(similarity)" }
}

struct TavilyResult: Sendable, Equatable, Identifiable {
    var title: String
    var content: String
    var url: String

    var id: String { url }
}

struct NoteAction: Sendable, Equatable, Identifiable {
    var noteID: String
    var noteTitle: String
    var created: Bool

    var id: String { noteID }
}

/// Receipt for a "Pick Up Your Cross" the assistant replaced this turn.
struct CrossAction: Sendable, Equatable, Identifiable {
    var reference: String
    var text: String
    var reason: String
    var previousReference: String?

    var id: String { "\(reference)-\(previousReference ?? "")" }
}

struct ChatAttachment: Sendable, Equatable, Identifiable {
    var id: String
    var filename: String
    var mediaType: String
    var size: Int = 0
    var previewURL: String
    var previewExpiresAt: String = ""
}

/// How confident the vector search was, shown as a badge on the verses card.
/// Thresholds are shared with `mobile/src/features/chat/RetrievedVersesCard.tsx`
/// and the web client — they were deliberately aligned on 2026-08-10, so they
/// must not drift here.
enum MatchStrength: Sendable, Equatable {
    case strong, moderate, broad

    init(average: Double) {
        if average > 0.75 { self = .strong }
        else if average > 0.6 { self = .moderate }
        else { self = .broad }
    }

    var label: String {
        switch self {
        case .strong: "Strong match"
        case .moderate: "Moderate match"
        case .broad: "Broad match"
        }
    }
}

// MARK: - View model

/// The render model every chat surface reads — a port of `ChatViewMessage` and
/// `toViewMessage` in `mobile/src/lib/chatView.ts`, which the web client shares.
struct ChatViewMessage: Sendable, Equatable, Identifiable {
    var id: String
    var role: UIMessage.Role
    var content: String
    var tavilyResults: [TavilyResult] = []
    var retrievedVerses: [RetrievedVerse] = []
    var averageSimilarity: Double?
    var followUps: [String] = []
    var noteActions: [NoteAction] = []
    var crossActions: [CrossAction] = []
    var attachments: [ChatAttachment] = []
    /// Label shown while a tool is running; only set during streaming.
    var activity: String?
    var isStreaming = false

    var matchStrength: MatchStrength? {
        averageSimilarity.map(MatchStrength.init(average:))
    }
}

extension ChatViewMessage {
    /// Labels for in-flight tool calls, keyed by the TS part discriminator.
    static let toolActivityLabels: [String: String] = [
        "tool-searchScripture": "Searching the Scriptures",
        "tool-getPassage": "Opening the passage",
        "tool-webSearch": "Searching the web",
        "tool-addToNote": "Writing to your note",
        "tool-readNote": "Reading your note",
        "tool-updateNote": "Rewriting your note",
        "tool-findNotes": "Looking through your notes",
        "tool-getCrossReferences": "Tracing cross-references",
        "tool-getOriginalText": "Opening the original text",
        "tool-lookupStrongs": "Studying the original word",
        "tool-getDailyCross": "Opening today's cross",
        "tool-setDailyCross": "Preparing your new day",
    ]

    /// Strip the trailing `[FOLLOWUP]` block the model appends — it drives the
    /// suggestion chips and must never render as answer text.
    static func visibleResponseContent(_ content: String) -> String {
        let body: Substring
        if let range = content.firstRange(of: /\r?\n?\[FOLLOWUP\]/) {
            body = content[..<range.lowerBound]
        } else {
            body = content[...]
        }
        return String(body.reversed().drop { $0.isWhitespace }.reversed())
    }

    /// Parse up to two unique follow-up questions out of the raw answer text.
    static func parseFollowUps(_ content: String) -> [String] {
        var followUps: [String] = []
        var seen = Set<String>()
        // `\s*` (not `[ \t]*`) so `[FOLLOWUP]` followed by a newline still finds
        // its question on the next line, matching the TS regex exactly.
        for match in content.matches(of: /\[FOLLOWUP\]\s*([^\r\n]+)/) {
            guard followUps.count < 2 else { break }
            let question = String(match.1).trimmingCharacters(in: .whitespaces)
            let normalized = question.lowercased()
            if !question.isEmpty, !seen.contains(normalized) {
                seen.insert(normalized)
                followUps.append(question)
            }
        }
        return followUps
    }

    /// Reduce a live or restored `UIMessage` into the render model.
    init(message: UIMessage, isStreaming: Bool) {
        let metadata = message.metadata ?? .null

        var text = ""
        var retrievedVerses = Self.parseVerses(metadata["retrievedVerses"])
        var similarities: [Double] = []
        var tavilyResults = Self.parseTavilyResults(metadata["tavilyResults"])
        var noteActions: [NoteAction] = []
        var crossActions: [CrossAction] = []
        var activity: String?

        // Attachment ids live in metadata, parallel to the message's file parts.
        let fileParts = message.parts.compactMap(\.filePart)
        let attachmentIDs = (metadata["attachmentIds"]?.arrayValue ?? []).compactMap(\.stringValue)
        let attachments = fileParts.enumerated().map { index, part in
            ChatAttachment(
                id: index < attachmentIDs.count ? attachmentIDs[index] : "\(message.id)-file-\(index)",
                filename: part.filename ?? "Attachment \(index + 1)",
                mediaType: part.mediaType,
                previewURL: part.url
            )
        }

        for part in message.parts {
            if let partText = part.textContent {
                text += partText
                continue
            }
            guard let tool = part.toolPart else { continue }

            if tool.state == .inputStreaming || tool.state == .inputAvailable {
                activity = Self.toolActivityLabels[tool.type] ?? "Working"
                continue
            }
            guard tool.state == .outputAvailable, let output = tool.output?.objectValue else { continue }

            switch tool.type {
            case "tool-searchScripture":
                let verses = Self.parseVerses(output["verses"])
                retrievedVerses.append(contentsOf: verses)
                similarities.append(contentsOf: verses.map(\.similarity))
            case "tool-getPassage":
                retrievedVerses.append(contentsOf: Self.parseVerses(output["verses"]))
            case "tool-webSearch":
                tavilyResults.append(contentsOf: Self.parseTavilyResults(output["results"]))
            case "tool-addToNote":
                if let noteID = output["noteId"]?.stringValue,
                   let noteTitle = output["noteTitle"]?.stringValue {
                    noteActions.append(
                        NoteAction(
                            noteID: noteID,
                            noteTitle: noteTitle,
                            created: output["created"]?.boolValue == true
                        )
                    )
                }
            case "tool-setDailyCross":
                // Only the write earns a receipt; reading the day is silent.
                if let reference = output["reference"]?.stringValue,
                   let text = output["text"]?.stringValue {
                    crossActions.append(
                        CrossAction(
                            reference: reference,
                            text: text,
                            reason: output["reason"]?.stringValue ?? "",
                            previousReference: output["previousReference"]?.stringValue
                        )
                    )
                }
            default:
                break
            }
        }

        // While streaming, only what has arrived counts. Once settled, merge in
        // any follow-ups persisted on the stored message.
        let followUps: [String]
        if isStreaming {
            followUps = Self.parseFollowUps(text)
        } else {
            let stored = (metadata["followUps"]?.arrayValue ?? []).compactMap(\.stringValue)
            var merged: [String] = []
            var seen = Set<String>()
            for question in Self.parseFollowUps(text) + stored where !seen.contains(question) {
                seen.insert(question)
                merged.append(question)
            }
            followUps = Array(merged.prefix(2))
        }

        let averageSimilarity: Double? =
            if let stored = metadata["averageSimilarity"]?.doubleValue {
                stored
            } else if similarities.isEmpty {
                nil
            } else {
                similarities.reduce(0, +) / Double(similarities.count)
            }

        self.init(
            id: message.id,
            role: message.role,
            content: Self.visibleResponseContent(text),
            tavilyResults: tavilyResults,
            retrievedVerses: retrievedVerses,
            averageSimilarity: averageSimilarity,
            followUps: followUps,
            noteActions: noteActions,
            crossActions: crossActions,
            attachments: attachments,
            activity: isStreaming ? activity : nil,
            isStreaming: isStreaming
        )
    }

    // MARK: Lenient parsing

    /// Both parsers drop malformed entries rather than failing the message —
    /// the same `flatMap` + type-guard behaviour as the TS original.
    private static func parseVerses(_ value: JSONValue?) -> [RetrievedVerse] {
        (value?.arrayValue ?? []).compactMap { verse in
            guard
                let reference = verse["reference"]?.stringValue,
                let similarity = verse["similarity"]?.doubleValue
            else { return nil }
            return RetrievedVerse(
                reference: reference,
                similarity: similarity,
                text: verse["text"]?.stringValue
            )
        }
    }

    private static func parseTavilyResults(_ value: JSONValue?) -> [TavilyResult] {
        (value?.arrayValue ?? []).compactMap { result in
            guard
                let title = result["title"]?.stringValue,
                let content = result["content"]?.stringValue,
                let url = result["url"]?.stringValue
            else { return nil }
            return TavilyResult(title: title, content: content, url: url)
        }
    }
}
