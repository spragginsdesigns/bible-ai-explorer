import Foundation

// MARK: - Card payloads

struct RetrievedVerse: Sendable, Equatable, Identifiable {
    var reference: String
    var similarity: Double
    var text: String?
    /// Translation that produced this text; absent on legacy/history rows.
    var translation: TranslationID? = nil

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

// MARK: - Receipts

/// One line for everything the assistant saves: the contract in
/// `docs/FEATURES.md` ("Receipts"), ported from `mobile/src/lib/receipts.ts`
/// and `src/lib/chat/receipts.ts`. Both TS copies share one fixture; the
/// receipt cases in `ChatViewMessageTests` mirror it, so change all three together.
enum ChatReceiptKind: String, Sendable, Equatable {
    case note, memory, highlight, plan, cross, preference, church
}

enum ChatReceiptSettingsSection: String, Sendable, Equatable {
    case memory, church, preferences
}

/// Where tapping the fragment goes. Mirrors the TS `ChatReceiptTarget` union.
enum ChatReceiptTarget: Sendable, Equatable {
    case note(noteID: String)
    case memories(memoryID: String?)
    case chapter(book: Int, chapter: Int, verse: Int?, translation: TranslationID?)
    case plan
    case cross
    case settings(section: ChatReceiptSettingsSection?)
}

/// Present only when the client can undo from the fragment.
enum ChatReceiptUndo: Sendable, Equatable {
    /// `DELETE /api/memories/[id]`.
    case forgetMemory(memoryID: String)
}

struct ChatReceipt: Sendable, Equatable, Identifiable {
    /// Stable within the message: the tool call id, or `memoryExtracted:<id>`.
    var id: String
    var kind: ChatReceiptKind
    /// The whole user-facing fragment, already worded.
    var label: String
    var target: ChatReceiptTarget
    var undo: ChatReceiptUndo? = nil
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
    /// Carried alongside `noteActions`/`crossActions` until every client
    /// renders receipts.
    var receipts: [ChatReceipt] = []
    var attachments: [ChatAttachment] = []
    /// Live "Getting ready / Reading <file> / Thinking" line, or the label of
    /// a tool that is mid-flight. Only ever set while streaming.
    var activity: String?
    var isStreaming = false

    var matchStrength: MatchStrength? {
        averageSimilarity.map(MatchStrength.init(average:))
    }

    /// A settled assistant shell has no UI except an otherwise duplicate avatar.
    var hasRenderableContent: Bool {
        if role == .user { return true }
        guard role == .assistant else { return false }
        return isStreaming
            || activity != nil
            || !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !tavilyResults.isEmpty
            || !retrievedVerses.isEmpty
            || !followUps.isEmpty
            || !noteActions.isEmpty
            || !crossActions.isEmpty
            || !attachments.isEmpty
    }
}

extension ChatViewMessage {
    /// Labels for in-flight tool calls, keyed by the TS part discriminator.
    static let toolActivityLabels: [String: String] = [
        "tool-searchScripture": "Searching the Scriptures",
        "tool-findVerses": "Searching the Bible for those words",
        "tool-searchOriginalLanguage": "Searching the Hebrew and Greek",
        "tool-getPassage": "Opening the passage",
        "tool-webSearch": "Searching the web",
        "tool-addToNote": "Writing to your note",
        "tool-readNote": "Reading your note",
        "tool-updateNote": "Rewriting your note",
        "tool-findNotes": "Looking through your notes",
        "tool-getHighlights": "Reading your highlights",
        "tool-listMemories": "Reading your memories",
        "tool-saveMemory": "Saving your memory",
        "tool-updateMemory": "Updating your memory",
        "tool-deleteMemories": "Deleting your memories",
        "tool-getCrossReferences": "Tracing cross-references",
        "tool-getOriginalText": "Opening the original text",
        "tool-lookupStrongs": "Studying the original word",
        "tool-lookupBibleEntity": "Looking them up in Scripture",
        "tool-getBibleTimeline": "Walking the timeline",
        "tool-getDailyCross": "Opening today's cross",
        "tool-setDailyCross": "Preparing your new day",
        "tool-getReadingPlan": "Opening your reading plan",
        "tool-startReadingPlan": "Setting up your reading plan",
        "tool-markReadingPlanDay": "Marking your reading",
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
        // The server's narration of the wait, replaced in place all stream.
        var statusActivity: String?
        // A tool that is running right now; it outranks the status line.
        var toolActivity: String?

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
            if let data = part.dataPart {
                // `data-status` is the only data part any SureWord client
                // renders; a malformed one is ignored rather than shown.
                if data.name == "status", let label = data.value["label"]?.stringValue {
                    statusActivity = label
                }
                continue
            }
            guard let tool = part.toolPart else { continue }

            if tool.state == .inputStreaming || tool.state == .inputAvailable {
                toolActivity = Self.toolActivityLabels[tool.type] ?? "Working"
                continue
            }
            guard tool.state == .outputAvailable, let output = tool.output?.objectValue else { continue }

            switch tool.type {
            // findVerses and searchOriginalLanguage return the same
            // ScriptureSearchToolOutput shape as searchScripture (the
            // original-language tool adds fields we ignore here), so all three
            // feed the one "Retrieved Verses" card.
            case "tool-searchScripture", "tool-findVerses", "tool-searchOriginalLanguage":
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

        let content = Self.visibleResponseContent(text)

        // Server status lines narrate the wait; once the answer itself is on
        // screen they are stale. A tool running mid-answer still says what it
        // is doing. Identical rule to `mobile/src/lib/chatView.ts`.
        let activity =
            toolActivity
            ?? (content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? statusActivity : nil)

        self.init(
            id: message.id,
            role: message.role,
            content: content,
            tavilyResults: tavilyResults,
            retrievedVerses: retrievedVerses,
            averageSimilarity: averageSimilarity,
            followUps: followUps,
            noteActions: noteActions,
            crossActions: crossActions,
            receipts: Self.buildReceipts(message.parts),
            attachments: attachments,
            activity: isStreaming ? activity : nil,
            isStreaming: isStreaming
        )
    }

    // MARK: Receipts

    /// A highlight in the reader's default colour needs no "as Yellow" suffix.
    private static let defaultHighlightColorName = "Yellow"

    /// Receipts for one message, in part order, from settled parts only. A
    /// tool that threw is `outputError` and one that declined has
    /// `success: false`; neither leaves a receipt. Same rules as
    /// `buildReceipts` in `mobile/src/lib/receipts.ts`.
    static func buildReceipts(_ parts: [UIMessagePart]) -> [ChatReceipt] {
        var receipts: [ChatReceipt] = []
        for (index, part) in parts.enumerated() {
            if let data = part.dataPart {
                // Data parts carry no tool call id; the memory id is unique
                // within a message.
                if data.name == "memoryExtracted",
                   let memoryID = nonEmpty(data.value["memoryId"]) {
                    receipts.append(memoryReceipt(id: "memoryExtracted:\(memoryID)", memoryID: memoryID))
                }
                continue
            }
            guard let tool = part.toolPart,
                  tool.state == .outputAvailable,
                  let output = tool.output,
                  output.objectValue != nil,
                  output["success"]?.boolValue != false
            else { continue }
            let id = tool.toolCallId.isEmpty ? "part-\(index)" : tool.toolCallId
            if let receipt = toolReceipt(
                toolName: tool.toolName,
                id: id,
                input: tool.input ?? .null,
                output: output
            ) {
                receipts.append(receipt)
            }
        }
        return receipts
    }

    private static func toolReceipt(
        toolName: String,
        id: String,
        input: JSONValue,
        output: JSONValue
    ) -> ChatReceipt? {
        switch toolName {
        case "addToNote", "updateNote":
            guard let noteID = nonEmpty(output["noteId"]),
                  let noteTitle = nonEmpty(output["noteTitle"])
            else { return nil }
            let label: String
            if toolName == "updateNote" {
                label = "Updated \(noteTitle)"
            } else if output["created"]?.boolValue == true, output["matchedExisting"]?.boolValue != true {
                label = "Saved to \(noteTitle)"
            } else {
                label = "Added to \(noteTitle)"
            }
            return ChatReceipt(id: id, kind: .note, label: label, target: .note(noteID: noteID))

        case "organizeNote":
            guard let noteID = nonEmpty(output["noteId"]),
                  let title = nonEmpty(output["title"])
            else { return nil }
            return ChatReceipt(id: id, kind: .note, label: "Filed \(title)", target: .note(noteID: noteID))

        case "saveMemory":
            guard output["success"]?.boolValue == true,
                  let memoryID = nonEmpty(output["memory"]?["id"])
            else { return nil }
            return memoryReceipt(id: id, memoryID: memoryID)

        case "updateMemory":
            guard output["success"]?.boolValue == true,
                  let memoryID = nonEmpty(output["memory"]?["id"])
            else { return nil }
            return ChatReceipt(
                id: id,
                kind: .memory,
                label: "Memory updated",
                target: .memories(memoryID: memoryID)
            )

        case "deleteMemories":
            // deleteMemories refuses unless every id is owned, so a zero count
            // means nothing changed and there is nothing to receipt.
            guard output["success"]?.boolValue == true,
                  let deleted = positiveInteger(output["deleted"])
            else { return nil }
            let noun = deleted == 1 ? "memory" : "memories"
            return ChatReceipt(
                id: id,
                kind: .memory,
                label: "Forgot \(deleted) \(noun)",
                target: .memories(memoryID: nil)
            )

        case "setDailyCross":
            guard let reference = nonEmpty(output["reference"]) else { return nil }
            return ChatReceipt(id: id, kind: .cross, label: "Today's cross: \(reference)", target: .cross)

        case "startReadingPlan":
            guard output["hasPlan"]?.boolValue == true,
                  let title = nonEmpty(output["title"])
            else { return nil }
            return ChatReceipt(id: id, kind: .plan, label: "Started \(title)", target: .plan)

        case "markReadingPlanDay":
            // The plan output does not say which day was ticked, so the number
            // comes from the call. An untick (done: false) has no contract
            // label, and "Marked day n" would state the opposite of what
            // happened, so it leaves no receipt.
            guard output["hasPlan"]?.boolValue == true,
                  let day = positiveInteger(input["day"]),
                  input["done"]?.boolValue != false
            else { return nil }
            return ChatReceipt(id: id, kind: .plan, label: "Marked day \(day)", target: .plan)

        case "highlightVerse":
            guard output["success"]?.boolValue == true,
                  let reference = nonEmpty(output["reference"]),
                  let book = positiveInteger(output["bookNumber"]),
                  let chapter = positiveInteger(output["chapter"]),
                  let verse = positiveInteger(output["verse"])
            else { return nil }
            let label: String
            if let colorName = nonEmpty(output["colorName"]), colorName != defaultHighlightColorName {
                label = "Marked \(reference) as \(colorName)"
            } else {
                label = "Marked \(reference)"
            }
            let translation = output["translation"]?.stringValue.flatMap(TranslationID.init(rawValue:))
            return ChatReceipt(
                id: id,
                kind: .highlight,
                label: label,
                target: .chapter(book: book, chapter: chapter, verse: verse, translation: translation)
            )

        default:
            return nil
        }
    }

    private static func memoryReceipt(id: String, memoryID: String) -> ChatReceipt {
        ChatReceipt(
            id: id,
            kind: .memory,
            label: "Remembered",
            target: .memories(memoryID: memoryID),
            undo: .forgetMemory(memoryID: memoryID)
        )
    }

    private static func nonEmpty(_ value: JSONValue?) -> String? {
        guard let string = value?.stringValue,
              !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return string
    }

    /// JSON numbers arrive as `Double`; only a whole number of at least 1 counts.
    private static func positiveInteger(_ value: JSONValue?) -> Int? {
        guard let number = value?.doubleValue,
              number >= 1,
              number < 1_000_000_000,
              number.rounded() == number
        else { return nil }
        return Int(number)
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
                text: verse["text"]?.stringValue,
                translation: verse["translation"]?.stringValue.flatMap(TranslationID.init(rawValue:))
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
