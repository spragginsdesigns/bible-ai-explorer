import UIKit
import UniformTypeIdentifiers
import XCTest

@testable import SureWord

/// "Share into SureWord" (PRD D8): the extension-to-app inbox, the manifest it
/// writes, and the planner that turns a share into a chat draft. The planner
/// cases mirror `mobile/src/features/share/__tests__/shareIntake.test.ts`.
final class ShareIntoSureWordTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("share-tests-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private var store: PendingShareStore { PendingShareStore(root: root) }

    /// Writes a share the way the extension does: folder, files, manifest last.
    @discardableResult
    private func writeShare(
        id: String = UUID().uuidString,
        createdAt: Date = Date(),
        text: String? = nil,
        webURL: String? = nil,
        files: [(name: String, type: String, data: Data)] = []
    ) throws -> PendingShareManifest {
        let directory = try store.makeShareDirectory(id: id)
        var entries: [PendingShareManifest.File] = []
        for (index, file) in files.enumerated() {
            let stored = PendingShareNaming.storedName(file.name, index: index + 1)
            try file.data.write(to: directory.appendingPathComponent(stored))
            entries.append(.init(
                storedName: stored,
                originalName: file.name,
                typeIdentifier: UTType(mimeType: file.type)?.identifier,
                mediaType: file.type,
                size: file.data.count
            ))
        }
        let manifest = PendingShareManifest(id: id, createdAt: createdAt, text: text, webURL: webURL, files: entries)
        try store.commit(manifest)
        return manifest
    }

    // MARK: Manifest

    func testManifestRoundTrips() throws {
        let manifest = PendingShareManifest(
            id: "abc",
            createdAt: Date(timeIntervalSince1970: 1_791_000_000),
            text: "Is this true?",
            webURL: "https://example.com/post",
            files: [.init(storedName: "1-voice.ogg", originalName: "voice.ogg", typeIdentifier: "org.xiph.ogg", mediaType: "audio/ogg", size: 1234)]
        )
        let data = try PendingShareManifest.encoder().encode(manifest)
        let decoded = try PendingShareManifest.decoder().decode(PendingShareManifest.self, from: data)
        XCTAssertEqual(decoded, manifest)
    }

    /// The wire format the extension and app agree on. An extension and app
    /// from different builds must still read each other.
    func testManifestDecodesPinnedJSON() throws {
        let json = """
        {"createdAt":"2026-10-07T12:00:00Z","files":[{"mediaType":"audio\\/mp4","originalName":"New Recording.m4a","size":42,"storedName":"1-New Recording.m4a","typeIdentifier":"com.apple.m4a-audio"}],"id":"share-1","text":"hello","version":1}
        """
        let manifest = try PendingShareManifest.decoder().decode(PendingShareManifest.self, from: Data(json.utf8))
        XCTAssertEqual(manifest.id, "share-1")
        XCTAssertEqual(manifest.text, "hello")
        XCTAssertNil(manifest.webURL)
        XCTAssertEqual(manifest.files.first?.originalName, "New Recording.m4a")
        XCTAssertEqual(manifest.files.first?.size, 42)
        XCTAssertEqual(manifest.createdAt, ISO8601DateFormatter().date(from: "2026-10-07T12:00:00Z"))

        let encoded = String(decoding: try PendingShareManifest.encoder().encode(manifest), as: UTF8.self)
        XCTAssertEqual(encoded, json)
    }

    // MARK: Store

    func testTakeHandsOverTheShareOnceAndEmptiesTheInbox() throws {
        let audio = Data("OggS-fake-voice".utf8)
        try writeShare(text: "What do you make of this?", files: [("voice-message.ogg", "audio/ogg", audio)])

        XCTAssertTrue(store.hasPending)
        let share = try XCTUnwrap(store.take())
        XCTAssertEqual(share.text, "What do you make of this?")
        XCTAssertEqual(share.files.count, 1)
        XCTAssertEqual(share.files.first?.name, "voice-message.ogg")
        XCTAssertEqual(share.files.first?.data, audio)

        XCTAssertFalse(store.hasPending)
        XCTAssertNil(store.take(), "a share is applied exactly once")
        let left = try FileManager.default.contentsOfDirectory(atPath: root.path)
        XCTAssertEqual(left, [], "consumed shares are cleaned up, files included")
    }

    func testEmptyOrMissingInboxHasNothing() {
        XCTAssertFalse(store.hasPending)
        XCTAssertNil(store.take())
    }

    func testANewerShareReplacesAnUnopenedOlderOne() throws {
        try writeShare(id: "old", createdAt: Date().addingTimeInterval(-60), text: "first")
        try writeShare(id: "new", text: "second")
        let left = try FileManager.default.contentsOfDirectory(atPath: root.path)
        XCTAssertEqual(left, ["new"], "commit drops the older share")
        XCTAssertEqual(store.take()?.text, "second")
    }

    /// Signed out, the share waits on disk; nothing but `take` removes it.
    func testShareWaitsUntilTaken() throws {
        try writeShare(text: "waiting through sign-in")
        XCTAssertTrue(store.hasPending)
        XCTAssertTrue(store.hasPending, "checking does not consume")
        XCTAssertEqual(store.take()?.text, "waiting through sign-in")
    }

    func testAHalfWrittenShareIsNeitherTakenNorDeleted() throws {
        let directory = try store.makeShareDirectory(id: "in-progress")
        try Data("partial".utf8).write(to: directory.appendingPathComponent("1-a.pdf"))
        XCTAssertFalse(store.hasPending)
        XCTAssertNil(store.take())
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.path), "the extension may still be writing it")
    }

    func testAnExpiredShareIsDroppedNotOpened() throws {
        try writeShare(createdAt: Date().addingTimeInterval(-(PendingShare.maxAge + 60)), text: "last week")
        XCTAssertNil(store.take())
        XCTAssertFalse(store.hasPending)
    }

    func testAManifestFromANewerVersionIsDiscarded() throws {
        var manifest = try writeShare(text: "from the future")
        manifest.version = PendingShareManifest.currentVersion + 1
        try store.commit(manifest)
        XCTAssertNil(store.take())
        XCTAssertFalse(store.hasPending)
    }

    func testAStoredNameThatLeavesTheFolderIsNotFollowed() throws {
        let secret = root.appendingPathComponent("secret.txt")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("do not read".utf8).write(to: secret)
        let directory = try store.makeShareDirectory(id: "evil")
        _ = directory
        try store.commit(PendingShareManifest(
            id: "evil",
            createdAt: Date(),
            files: [.init(storedName: "../secret.txt", originalName: "secret.txt", typeIdentifier: nil, mediaType: "text/plain", size: nil)]
        ))
        let share = try XCTUnwrap(store.take())
        XCTAssertNil(share.files.first?.data)
    }

    // MARK: Collection (extension side)

    func testCollectionDropsATextThatIsTheSharedLink() {
        let collection = PendingShareCollection(
            texts: ["https://example.com/a", "  Look at this  ", "Look at this"],
            webURLs: ["https://example.com/a"]
        )
        let manifest = collection.manifest(id: "x")
        XCTAssertEqual(manifest.webURL, "https://example.com/a")
        XCTAssertEqual(manifest.text, "Look at this")
        XCTAssertEqual(collection.summary, "A link and text")
    }

    func testCollectionSummaryCountsKinds() {
        let voice = PendingShareManifest.File(storedName: "1-a.m4a", originalName: "a.m4a", typeIdentifier: nil, mediaType: "audio/x-m4a", size: 1)
        let photo = PendingShareManifest.File(storedName: "2-b.heic", originalName: "b.heic", typeIdentifier: nil, mediaType: "image/heic", size: 1)
        XCTAssertEqual(PendingShareCollection(files: [voice]).summary, "A voice message")
        XCTAssertEqual(PendingShareCollection(files: [photo, photo]).summary, "2 pictures")
        XCTAssertEqual(PendingShareCollection(texts: ["hi"], files: [voice, photo]).summary, "A voice message, a picture and text")
        XCTAssertTrue(PendingShareCollection(texts: ["  "]).isEmpty)
    }

    func testNamingGivesExtensionlessFilesTheirTypesExtension() {
        XCTAssertEqual(PendingShareNaming.name(suggested: "New Recording", url: nil, type: .mpeg4Audio), "New Recording.m4a")
        XCTAssertEqual(
            PendingShareNaming.name(suggested: nil, url: URL(fileURLWithPath: "/tmp/voice-message.ogg"), type: .data),
            "voice-message.ogg"
        )
        XCTAssertEqual(PendingShareNaming.name(suggested: "Sermon notes.pdf", url: nil, type: .pdf), "Sermon notes.pdf")
        XCTAssertEqual(PendingShareNaming.storedName("../a/b:c.txt", index: 3), "3-_._a_b_c.txt")
        XCTAssertEqual(PendingShareNaming.storedName(".hidden", index: 1), "1-_hidden")
        XCTAssertEqual(PendingShareNaming.mediaType(for: .pdf, filename: nil), "application/pdf")
    }

    // MARK: Planner (shareIntake.ts parity)

    func testTextGoesInTheComposerAndFilesAreAttached() {
        let draft = ShareIntake.plan(
            text: "  Is this biblical?  ",
            webURL: nil,
            files: [.init(filename: "voice-message", mediaType: "audio/opus", data: Data(repeating: 1, count: 10), size: 10)]
        )
        XCTAssertEqual(draft.text, "Is this biblical?")
        XCTAssertEqual(draft.files.map(\.filename), ["voice-message.ogg"])
        XCTAssertEqual(draft.files.map(\.mediaType), ["audio/ogg"], "aliases are read as the canonical type")
        XCTAssertEqual(draft.notices, [])
    }

    func testVoiceMemosM4AIsAccepted() {
        let draft = ShareIntake.plan(
            text: nil,
            webURL: nil,
            files: [.init(filename: "New Recording.m4a", mediaType: "audio/x-m4a", data: Data(repeating: 1, count: 10), size: 10)]
        )
        XCTAssertEqual(draft.files.first?.mediaType, "audio/mp4")
    }

    func testURLIsUsedWhenThereIsNoText() {
        XCTAssertEqual(ShareIntake.plan(text: nil, webURL: "https://example.com", files: []).text, "https://example.com")
        XCTAssertEqual(ShareIntake.composerText(text: "Read https://x.y", webURL: "https://x.y"), "Read https://x.y")
        XCTAssertEqual(ShareIntake.composerText(text: "A title", webURL: "https://x.y"), "A title\n\nhttps://x.y")
    }

    func testUnsupportedFilesAreExplainedNotAttached() {
        let draft = ShareIntake.plan(
            text: "hi",
            webURL: nil,
            files: [.init(filename: "clip.mov", mediaType: "video/quicktime", data: Data([1]), size: 1)]
        )
        XCTAssertEqual(draft.files, [])
        XCTAssertEqual(draft.notices, [AttachmentValidator.unsupported("clip.mov")])
    }

    func testAFileTooLargeToCopyIsExplainedBySize() {
        let draft = ShareIntake.plan(
            text: nil,
            webURL: nil,
            files: [.init(filename: "long.m4a", mediaType: "audio/mp4", data: nil, size: 30 * 1024 * 1024)]
        )
        XCTAssertEqual(draft.notices, ["long.m4a exceeds the 20 MB file limit."])
    }

    func testAnUnreadableFileIsExplained() {
        let draft = ShareIntake.plan(text: nil, webURL: nil, files: [.init(filename: "a.pdf", mediaType: "application/pdf", data: nil, size: nil)])
        XCTAssertEqual(draft.notices, ["a.pdf is empty or unreadable."])
    }

    func testOnlyTheFirstFiveFilesAreAttached() {
        let files = (1...7).map { IncomingSharedFile(filename: "p\($0).png", mediaType: "image/png", data: Data([1]), size: 1) }
        let draft = ShareIntake.plan(text: nil, webURL: nil, files: files)
        XCTAssertEqual(draft.files.count, 5)
        XCTAssertEqual(draft.notices, ["You can attach up to 5 files per message, so only the first 5 were attached."])
    }

    func testTheMessageTotalIsEnforced() {
        let big = Data(repeating: 1, count: 9 * 1024 * 1024)
        let files = (1...3).map { IncomingSharedFile(filename: "doc\($0).pdf", mediaType: "application/pdf", data: big, size: big.count) }
        let draft = ShareIntake.plan(text: nil, webURL: nil, files: files)
        XCTAssertEqual(draft.files.map(\.filename), ["doc1.pdf", "doc2.pdf"])
        XCTAssertEqual(draft.notices, ["Attachments can total up to 25 MB per message, so doc3.pdf was left out."])
    }

    func testAnEmptyShareSaysSo() {
        XCTAssertEqual(
            ShareIntake.plan(text: "  ", webURL: nil, files: []).notices,
            ["Nothing in that share could be opened in SureWord."]
        )
    }

    func testShareActionsSendTheCommandWithTheComposer() {
        XCTAssertEqual(ShareAction.actions(for: "Karma is biblical").map(\.label), ["Check against Scripture", "Help me reply"])
        // A shared link leads with Verify, worded for a video when it is one.
        let video = "https://youtu.be/GMwihA5jnhY"
        XCTAssertEqual(
            ShareAction.actions(for: video).map { $0.label(composerText: video) },
            ["Verify this video", "Check against Scripture", "Help me reply"]
        )
        XCTAssertEqual(ShareAction.verify.label(composerText: "https://example.com/post"), "Verify this link")
        XCTAssertEqual(ShareAction.verify.message(composerText: video), "/verify \(video)")
        XCTAssertNotNil(SlashCommand.parse("/verify \(video)"))
        XCTAssertEqual(ShareAction.check.message(composerText: "  "), "/check")
        XCTAssertEqual(ShareAction.reply.message(composerText: " what they said "), "/reply what they said")
        // Both are real chat commands the composer palette offers.
        XCTAssertNotNil(SlashCommand.parse("/check"))
        XCTAssertNotNil(SlashCommand.parse("/reply"))
    }

    // MARK: Inbox to draft (iOS layer)

    func testAPhotosHEICShareIsReEncodedLikeThePicker() throws {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 30)).image { context in
            UIColor.orange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 40, height: 30))
        }
        let jpeg = try XCTUnwrap(image.jpegData(compressionQuality: 0.9))
        let incoming = ShareInboxIntake.incomingFile(.init(
            name: "IMG_0042.HEIC",
            typeIdentifier: UTType.heic.identifier,
            mediaType: "image/heic",
            size: jpeg.count,
            data: jpeg
        ))
        XCTAssertEqual(incoming.filename, "IMG_0042.jpg")
        XCTAssertEqual(incoming.mediaType, "image/jpeg")

        let draft = ShareInboxIntake.draft(for: ReceivedShare(text: nil, webURL: nil, files: [.init(
            name: "IMG_0042.HEIC", typeIdentifier: UTType.heic.identifier, mediaType: "image/heic", size: jpeg.count, data: jpeg
        )]))
        XCTAssertEqual(draft.files.map(\.filename), ["IMG_0042.jpg"])
        XCTAssertEqual(draft.notices, [])
    }

    func testAudioAndPDFPassThroughUntouched() {
        let pdf = Data("%PDF-1.4".utf8)
        let incoming = ShareInboxIntake.incomingFile(.init(
            name: "Sermon.pdf", typeIdentifier: UTType.pdf.identifier, mediaType: "application/pdf", size: pdf.count, data: pdf
        ))
        XCTAssertEqual(incoming, IncomingSharedFile(filename: "Sermon.pdf", mediaType: nil, data: pdf, size: pdf.count))
    }

    /// The system's MIME type for .webm is video/webm; a shared WebM voice
    /// note must still attach as audio/webm, as it does from the Files picker.
    func testSharedWebMVoiceNoteGoesByItsExtension() {
        let audio = Data([0x1A, 0x45, 0xDF, 0xA3])
        let draft = ShareInboxIntake.draft(for: ReceivedShare(text: nil, webURL: nil, files: [
            .init(name: "voice.webm", typeIdentifier: "org.webmproject.webm", mediaType: "video/webm", size: 4, data: audio),
            .init(name: "PTT-1", typeIdentifier: nil, mediaType: "audio/opus", size: 4, data: audio),
        ]))
        XCTAssertEqual(draft.files.map(\.filename), ["voice.webm", "PTT-1.ogg"])
        XCTAssertEqual(draft.files.map(\.mediaType), ["audio/webm", "audio/ogg"])
        XCTAssertEqual(draft.notices, [])
    }

    func testTakeDraftEndToEndFromTheInbox() throws {
        try writeShare(text: "From Discord", files: [("PTT-20261007", "audio/ogg", Data("OggS".utf8))])
        let draft = try XCTUnwrap(ShareInboxIntake.takeDraft(from: store))
        XCTAssertEqual(draft.text, "From Discord")
        XCTAssertEqual(draft.files.map(\.filename), ["PTT-20261007.ogg"])
        XCTAssertNil(ShareInboxIntake.takeDraft(from: store))
    }

    // MARK: Chat

    @MainActor
    func testStartSharedChatPrefillsAFreshChatWithTheActions() async {
        let chat = ChatViewModel(
            api: APIClient(baseURL: URL(string: "https://example.invalid")!, token: { _ in nil }, onAuthFailure: {}),
            settings: SettingsStore()
        )
        chat.input = "an old draft"
        await chat.startSharedChat(SharedChatDraft(text: "Shared words", files: [], notices: ["clip.mov was left out"]))
        XCTAssertEqual(chat.input, "Shared words")
        XCTAssertEqual(chat.shareNotices, ["clip.mov was left out"])
        XCTAssertNil(chat.activeConversationID)

        chat.newConversation()
        XCTAssertNil(chat.shareNotices, "a new chat drops the share actions")
    }
}
