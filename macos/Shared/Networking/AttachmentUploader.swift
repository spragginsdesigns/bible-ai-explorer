import Foundation

/// The three-step upload the shared backend requires, ported from
/// `uploadChatAttachments` in `mobile/src/features/chat/fileAttachments.ts`:
///
/// 1. `POST /api/chat/attachments` reserves a row per file and hands back a
///    presigned Blob URL for each.
/// 2. `PUT` the bytes straight to that URL — the API never sees the file.
/// 3. `POST /api/chat/attachments/{id}/complete` makes the row `READY`, which is
///    also where the server sniffs the magic bytes and rejects a `.png` that is
///    really something else.
///
/// If any file fails, **every** id from the batch is deleted. A reserved-but-never
/// completed row is invisible to the user but still blocks the 5-per-message cap,
/// so leaking one would degrade the next message they try to send.
struct AttachmentUploader: Sendable {
    let api: APIClient

    private struct InitResponse: Decodable {
        struct Upload: Decodable {
            let id: String
            let mediaType: String
            let uploadUrl: String
        }
        let uploads: [Upload]
    }

    private struct CompleteResponse: Decodable {
        let attachment: ChatAttachmentDescriptor
    }

    private struct RefreshResponse: Decodable {
        let attachments: [ChatAttachmentDescriptor]
    }

    private struct FileRequest: Encodable {
        let filename: String
        let mediaType: String
        let size: Int
    }

    private struct InitRequest: Encodable {
        let files: [FileRequest]
    }

    private struct IDsRequest: Encodable {
        let ids: [String]
    }

    func upload(_ files: [LocalAttachment]) async throws -> [ChatAttachmentDescriptor] {
        let initialized = try await api.json(
            "/api/chat/attachments",
            method: "POST",
            body: InitRequest(
                files: files.map {
                    FileRequest(filename: $0.filename, mediaType: $0.mediaType, size: $0.size)
                }
            ),
            as: InitResponse.self
        )

        guard initialized.uploads.count == files.count else {
            throw APIError(message: "The server accepted a different number of files than we sent.")
        }

        do {
            var completed: [ChatAttachmentDescriptor] = []
            // Sequential rather than parallel: five 10 MB PUTs at once on a home
            // connection is how you get a timeout instead of an upload.
            for (index, upload) in initialized.uploads.enumerated() {
                let file = files[index]
                guard let url = URL(string: upload.uploadUrl) else {
                    throw APIError(message: "Could not upload \(file.filename).")
                }
                do {
                    try await api.upload(to: url, data: file.data, contentType: upload.mediaType)
                } catch {
                    // The Blob host's own error text means nothing to a reader.
                    throw AttachmentError(message: "Could not upload \(file.filename).")
                }
                let response = try await api.json(
                    "/api/chat/attachments/\(upload.id)/complete",
                    method: "POST",
                    as: CompleteResponse.self
                )
                completed.append(response.attachment)
            }
            return completed
        } catch {
            await deleteAll(initialized.uploads.map(\.id))
            throw error
        }
    }

    /// Detach a staged file. The server refuses this once the attachment belongs
    /// to a sent message, which is why only drafts can be removed.
    func delete(_ id: String) async throws {
        try await api.data("/api/chat/attachments/\(id)", method: "DELETE")
    }

    /// Best-effort cleanup — used on discard paths where there is nothing useful
    /// to tell the user if it fails.
    func deleteAll(_ ids: [String]) async {
        for id in ids { try? await delete(id) }
    }

    /// Preview URLs are presigned for 15 minutes; this mints fresh ones so a
    /// long-lived conversation keeps showing its images.
    func refresh(_ ids: [String]) async throws -> [ChatAttachmentDescriptor] {
        guard !ids.isEmpty else { return [] }
        return try await api.json(
            "/api/chat/attachments/refresh",
            method: "POST",
            body: IDsRequest(ids: ids),
            as: RefreshResponse.self
        ).attachments
    }
}
