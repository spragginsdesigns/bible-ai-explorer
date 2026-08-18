import Foundation

extension UIMessage {
    /// Rebuild a message from a stored row of `GET /api/conversations/{id}/messages`
    /// — a port of `dbMessageToUIMessage` in `mobile/src/lib/chatView.ts`.
    ///
    /// Restoring from `metadata.parts` rather than the flat `content` column is
    /// what brings tool cards, verses and web results back when an old
    /// conversation is reopened; falling back to plain text would silently lose
    /// them.
    init?(storedRow value: JSONValue) {
        guard
            let id = value["id"]?.stringValue,
            let roleName = value["role"]?.stringValue,
            let role = Role(rawValue: roleName),
            let content = value["content"]?.stringValue
        else { return nil }

        let metadata = value["metadata"]?.objectValue ?? [:]

        let restoredParts: [UIMessagePart] =
            if let stored = metadata["parts"]?.arrayValue {
                stored.compactMap(UIMessagePart.init(json:))
            } else {
                [.text(id: "restored", text: content)]
            }

        // Attachments are stored as their own rows, not as parts, so their file
        // parts are rebuilt and put first — matching the order the TS clients use.
        let storedAttachments = (value["attachments"]?.arrayValue ?? []).filter { $0.objectValue != nil }
        let attachmentParts: [UIMessagePart] = storedAttachments.compactMap { attachment in
            guard
                let filename = attachment["filename"]?.stringValue,
                let mediaType = attachment["mediaType"]?.stringValue,
                let previewURL = attachment["previewUrl"]?.stringValue
            else { return nil }
            return .file(FilePart(url: previewURL, mediaType: mediaType, filename: filename))
        }

        let parts: [UIMessagePart] =
            attachmentParts.isEmpty
                ? restoredParts
                : attachmentParts + restoredParts.filter { $0.filePart == nil }

        let attachmentIDs = storedAttachments.compactMap { $0["id"]?.stringValue }

        var legacyMetadata = metadata
        legacyMetadata["parts"] = nil
        if !attachmentIDs.isEmpty {
            legacyMetadata["attachmentIds"] = .array(attachmentIDs.map(JSONValue.string))
        }

        self.init(
            id: id,
            role: role,
            parts: parts,
            metadata: legacyMetadata.isEmpty ? nil : .object(legacyMetadata)
        )
    }
}

extension UIMessagePart {
    /// Decode one persisted part. Tool parts carry their name in the
    /// discriminator (`tool-searchScripture`), as the AI SDK writes them.
    init?(json: JSONValue) {
        guard let type = json["type"]?.stringValue else { return nil }

        switch type {
        case "text":
            self = .text(id: json["id"]?.stringValue ?? "restored", text: json["text"]?.stringValue ?? "")

        case "reasoning":
            self = .reasoning(
                id: json["id"]?.stringValue ?? "restored",
                text: json["text"]?.stringValue ?? ""
            )

        case "file":
            guard let url = json["url"]?.stringValue else { return nil }
            self = .file(
                FilePart(
                    url: url,
                    mediaType: json["mediaType"]?.stringValue ?? "",
                    filename: json["filename"]?.stringValue
                )
            )

        default:
            guard type.hasPrefix("tool-") else { return nil }
            self = .tool(
                ToolPart(
                    toolCallId: json["toolCallId"]?.stringValue ?? "",
                    toolName: String(type.dropFirst("tool-".count)),
                    // A persisted tool call has already finished, so treat an
                    // unreadable state as complete rather than as still running —
                    // otherwise reopening a conversation shows a spinner forever.
                    state: ToolState(rawValue: json["state"]?.stringValue ?? "") ?? .outputAvailable,
                    input: json["input"],
                    output: json["output"]
                )
            )
        }
    }
}
