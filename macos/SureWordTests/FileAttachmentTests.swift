import Foundation
import Testing
@testable import SureWord

/// Pinned to `mobile/src/features/chat/fileAttachments.ts` and to the server's
/// `src/lib/chat-attachment-types.ts`. The error strings are asserted verbatim:
/// they are user-facing copy that must read identically on Android and here, and
/// the server rejects the same files with its own wording, so a drift would show
/// up as two different messages for one mistake.
@Suite("File attachments")
struct FileAttachmentTests {

    private func bytes(_ count: Int) -> Data { Data(repeating: 0x41, count: count) }

    private func normalize(
        _ filename: String,
        _ declared: String = "",
        size: Int = 8
    ) throws -> LocalAttachment {
        try AttachmentValidator.normalize(
            filename: filename,
            declaredMediaType: declared,
            data: bytes(size)
        )
    }

    // MARK: Type allowlist

    @Test("Every documented extension maps to its media type")
    func allowedExtensions() throws {
        let expected: [String: String] = [
            "shot.png": "image/png",
            "photo.jpg": "image/jpeg",
            "photo.jpeg": "image/jpeg",
            "art.webp": "image/webp",
            "loop.gif": "image/gif",
            "notes.pdf": "application/pdf",
            "notes.txt": "text/plain",
            "notes.md": "text/markdown",
            "notes.markdown": "text/markdown",
            "rows.csv": "text/csv",
            "data.json": "application/json",
        ]
        for (filename, mediaType) in expected {
            #expect(try normalize(filename).mediaType == mediaType)
        }
    }

    @Test("Extensions are matched case-insensitively")
    func uppercaseExtension() throws {
        #expect(try normalize("SHOT.PNG").mediaType == "image/png")
    }

    @Test("An unsupported type is rejected with Android's wording")
    func unsupportedType() {
        #expect(throws: AttachmentError(
            message: "clip.mov is not a supported PNG, JPEG, WebP, GIF, PDF, TXT, Markdown, CSV, or JSON file."
        )) {
            try normalize("clip.mov")
        }
    }

    @Test("A file with no extension is rejected")
    func noExtension() {
        #expect(throws: AttachmentError(message: AttachmentValidator.unsupported("README"))) {
            try normalize("README")
        }
    }

    /// The server cross-checks the declared type against the extension and 400s on
    /// a mismatch, so catching it here saves a round trip.
    @Test("A declared type that contradicts the extension is rejected")
    func mismatchedDeclaredType() {
        #expect(throws: AttachmentError(message: AttachmentValidator.unsupported("shot.png"))) {
            try normalize("shot.png", "application/pdf")
        }
    }

    @Test("An octet-stream or empty declared type falls back to the extension")
    func octetStreamFallsBack() throws {
        #expect(try normalize("shot.png", "application/octet-stream").mediaType == "image/png")
        #expect(try normalize("shot.png", "").mediaType == "image/png")
    }

    @Test("A charset parameter on the declared type is ignored")
    func declaredTypeWithCharset() throws {
        #expect(try normalize("notes.txt", "text/plain; charset=utf-8").mediaType == "text/plain")
    }

    // MARK: Size caps

    @Test("An empty file is rejected")
    func emptyFile() {
        #expect(throws: AttachmentError(message: "shot.png is empty or unreadable.")) {
            try normalize("shot.png", size: 0)
        }
    }

    @Test("Images and PDFs are capped at 10 MB")
    func imageCap() throws {
        let limit = AttachmentLimits.maxImageOrPDFBytes
        #expect(try normalize("shot.png", size: limit).size == limit)
        #expect(throws: AttachmentError(message: "shot.png exceeds the 10 MB file limit.")) {
            try normalize("shot.png", size: limit + 1)
        }
        #expect(throws: AttachmentError(message: "book.pdf exceeds the 10 MB file limit.")) {
            try normalize("book.pdf", size: limit + 1)
        }
    }

    @Test("Text and JSON are capped at 1 MB")
    func textCap() throws {
        let limit = AttachmentLimits.maxTextBytes
        #expect(try normalize("notes.txt", size: limit).size == limit)
        for name in ["notes.txt", "notes.md", "rows.csv", "data.json"] {
            #expect(throws: AttachmentError(message: "\(name) exceeds the 1 MB file limit.")) {
                try normalize(name, size: limit + 1)
            }
        }
    }

    @Test("The cap follows the media type, not the extension family")
    func capSelection() {
        #expect(AttachmentLimits.byteLimit(for: "image/png") == 10 * 1024 * 1024)
        #expect(AttachmentLimits.byteLimit(for: "application/pdf") == 10 * 1024 * 1024)
        #expect(AttachmentLimits.byteLimit(for: "text/csv") == 1024 * 1024)
        #expect(AttachmentLimits.byteLimit(for: "application/json") == 1024 * 1024)
    }

    // MARK: Batch caps

    private func staged(_ count: Int, size: Int = 1) -> [ChatAttachmentDescriptor] {
        (0..<count).map {
            ChatAttachmentDescriptor(
                id: "id-\($0)",
                filename: "f\($0).png",
                mediaType: "image/png",
                size: size,
                previewUrl: "https://blob.example/\($0)",
                previewExpiresAt: ""
            )
        }
    }

    @Test("At most five files per message, counting what is already staged")
    func countCap() throws {
        let five = try (0..<5).map { try normalize("f\($0).png") }
        try AttachmentValidator.validateBatch(five, existing: [])

        #expect(throws: AttachmentError(message: "You can attach up to 5 files per message.")) {
            try AttachmentValidator.validateBatch(five + [try normalize("f5.png")], existing: [])
        }
        // Three more on top of three already staged is also six.
        #expect(throws: AttachmentError(message: "You can attach up to 5 files per message.")) {
            try AttachmentValidator.validateBatch(Array(five.prefix(3)), existing: staged(3))
        }
    }

    @Test("Attachments total at most 25 MB per message, counting what is staged")
    func totalCap() throws {
        let big = try normalize("a.png", size: 9 * 1024 * 1024)
        try AttachmentValidator.validateBatch([big, big], existing: [])

        #expect(throws: AttachmentError(message: "Attachments can total up to 25 MB per message.")) {
            try AttachmentValidator.validateBatch([big, big, big], existing: [])
        }
        #expect(throws: AttachmentError(message: "Attachments can total up to 25 MB per message.")) {
            try AttachmentValidator.validateBatch(
                [big, big],
                existing: staged(1, size: 8 * 1024 * 1024)
            )
        }
    }

    @Test("Limits match the server's constants")
    func limitsMatchServer() {
        #expect(AttachmentLimits.maxPerMessage == 5)
        #expect(AttachmentLimits.maxMessageBytes == 25 * 1024 * 1024)
        #expect(AttachmentLimits.maxImageOrPDFBytes == 10 * 1024 * 1024)
        #expect(AttachmentLimits.maxTextBytes == 1024 * 1024)
        #expect(AttachmentLimits.mediaTypes == [
            "application/json", "application/pdf", "image/gif", "image/jpeg",
            "image/png", "image/webp", "text/csv", "text/markdown", "text/plain",
        ])
    }

    // MARK: Byte formatting

    @Test("Sizes read the way Android renders them")
    func byteFormatting() {
        #expect(formatAttachmentBytes(0) == "")
        #expect(formatAttachmentBytes(-1) == "")
        #expect(formatAttachmentBytes(1) == "1 KB")
        #expect(formatAttachmentBytes(2048) == "2 KB")
        #expect(formatAttachmentBytes(1024 * 1024) == "1.0 MB")
        #expect(formatAttachmentBytes(5 * 1024 * 1024 + 512 * 1024) == "5.5 MB")
    }
}

// MARK: - Outgoing request shape

/// What `/api/ask-question` must receive for the backend to hydrate the files.
/// `hydrateTrustedAttachments` reads `metadata.attachmentIds` and rebuilds trusted
/// file parts from it, so an id in the wrong place means the model never sees the
/// attachment even though the upload succeeded.
@Suite("Attachment request shape")
struct AttachmentRequestShapeTests {

    private func descriptor(_ id: String, _ filename: String, _ mediaType: String) -> ChatAttachmentDescriptor {
        ChatAttachmentDescriptor(
            id: id,
            filename: filename,
            mediaType: mediaType,
            size: 42,
            previewUrl: "https://blob.example/\(id)",
            previewExpiresAt: "2026-08-12T18:00:00.000Z"
        )
    }

    /// Mirrors how `ChatViewModel.send` assembles the outgoing user message.
    private func outgoing(text: String, attachments: [ChatAttachmentDescriptor]) -> UIMessage {
        var parts: [UIMessagePart] = attachments.map {
            .file(FilePart(url: $0.previewUrl, mediaType: $0.mediaType, filename: $0.filename))
        }
        if !text.isEmpty { parts.append(.text(id: "0", text: text)) }
        return UIMessage(
            id: "user-1",
            role: .user,
            parts: parts,
            metadata: attachments.isEmpty
                ? nil
                : .object(["attachmentIds": .array(attachments.map { .string($0.id) })])
        )
    }

    @Test("File parts come first and carry filename, mediaType and url")
    func filePartsLeadTheMessage() throws {
        let message = outgoing(
            text: "What does this say?",
            attachments: [descriptor("a1", "shot.png", "image/png")]
        )
        let json = message.json
        let parts = try #require(json["parts"]?.arrayValue)

        #expect(parts.count == 2)
        #expect(parts[0]["type"]?.stringValue == "file")
        #expect(parts[0]["filename"]?.stringValue == "shot.png")
        #expect(parts[0]["mediaType"]?.stringValue == "image/png")
        #expect(parts[0]["url"]?.stringValue == "https://blob.example/a1")
        #expect(parts[1]["type"]?.stringValue == "text")
        #expect(parts[1]["text"]?.stringValue == "What does this say?")
    }

    @Test("Attachment ids ride in metadata, in order")
    func idsRideInMetadata() throws {
        let message = outgoing(
            text: "",
            attachments: [
                descriptor("a1", "one.png", "image/png"),
                descriptor("a2", "two.txt", "text/plain"),
            ]
        )
        let ids = try #require(message.json["metadata"]?["attachmentIds"]?.arrayValue)
        #expect(ids.compactMap(\.stringValue) == ["a1", "a2"])
    }

    @Test("An attachment-only message carries no empty text part")
    func attachmentOnlyMessage() throws {
        let message = outgoing(text: "", attachments: [descriptor("a1", "shot.png", "image/png")])
        let parts = try #require(message.json["parts"]?.arrayValue)
        #expect(parts.count == 1)
        #expect(parts[0]["type"]?.stringValue == "file")
    }

    @Test("A plain message still sends no metadata at all")
    func plainMessageHasNoMetadata() {
        let message = outgoing(text: "Who was Melchizedek?", attachments: [])
        #expect(message.json["metadata"] == nil)
        #expect(message.json["parts"]?.arrayValue?.count == 1)
    }

    /// The round trip that makes history restore work: what the server stores as
    /// separate attachment rows must come back as file parts plus ids.
    @Test("A stored row with attachments restores its file parts and ids")
    func historyRestoreRoundTrip() throws {
        let row = JSONValue.object([
            "id": .string("msg-1"),
            "role": .string("user"),
            "content": .string("What does this say?"),
            "metadata": .object([:]),
            "attachments": .array([
                .object([
                    "id": .string("a1"),
                    "filename": .string("shot.png"),
                    "mediaType": .string("image/png"),
                    "size": .number(42),
                    "previewUrl": .string("https://blob.example/a1"),
                ]),
            ]),
        ])
        let restored = try #require(UIMessage(storedRow: row))
        let view = ChatViewMessage(message: restored, isStreaming: false)

        #expect(view.attachments.count == 1)
        #expect(view.attachments[0].id == "a1")
        #expect(view.attachments[0].filename == "shot.png")
        #expect(view.attachments[0].mediaType == "image/png")
        #expect(view.attachments[0].previewURL == "https://blob.example/a1")
        #expect(view.content == "What does this say?")
    }
}
