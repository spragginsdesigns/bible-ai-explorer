import UniformTypeIdentifiers
import XCTest

@testable import SureWord

/// The extension half of "Share into SureWord", now in `ShareInbox/` so both
/// share extensions run it (iOS, and the Mac's `SureWord-macOS-Share`): what
/// the collector takes from the host app's providers, the caps its copies stop
/// at, and the Mac's two inboxes opening as one. Nothing here is iOS-only;
/// `ShareIntoSureWordTests` pins the inbox and planner themselves.
@MainActor
final class ShareCollectorTests: XCTestCase {
    private var base: URL!

    override func setUpWithError() throws {
        base = FileManager.default.temporaryDirectory
            .appendingPathComponent("share-collector-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: base)
    }

    private func store(_ name: String = "PendingShares") -> PendingShareStore {
        PendingShareStore(root: base.appendingPathComponent(name, isDirectory: true))
    }

    private func item(_ providers: [NSItemProvider], message: String? = nil) -> NSExtensionItem {
        let item = NSExtensionItem()
        item.attachments = providers
        if let message { item.attributedContentText = NSAttributedString(string: message) }
        return item
    }

    /// A file in the "sending app" to share.
    private func source(_ name: String, _ data: Data) throws -> URL {
        let folder = base.appendingPathComponent("Sender", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent(name)
        try data.write(to: url)
        return url
    }

    // MARK: Providers

    func testTextAndALinkAreCollectedAsTheyWereShared() async throws {
        let directory = try store().makeShareDirectory(id: "s1")
        let collected = await ShareCollector.collect([item([
            NSItemProvider(item: "Is this true?" as NSString, typeIdentifier: UTType.plainText.identifier),
            NSItemProvider(item: URL(string: "https://example.com/post")! as NSURL, typeIdentifier: UTType.url.identifier),
        ])], into: directory)

        XCTAssertEqual(collected.texts, ["Is this true?"])
        XCTAssertEqual(collected.webURLs, ["https://example.com/post"])
        XCTAssertTrue(collected.files.isEmpty)
        XCTAssertEqual(collected.summary, "A link and text")
    }

    /// Safari hands a page over as the link and the same link as text; it
    /// is one link, and the item's message is kept beside it.
    func testALinkSharedAsTextTooIsOneLink() async throws {
        let directory = try store().makeShareDirectory(id: "s2")
        let link = "https://www.youtube.com/watch?v=abc"
        let collected = await ShareCollector.collect([item([
            NSItemProvider(item: URL(string: link)! as NSURL, typeIdentifier: UTType.url.identifier),
            NSItemProvider(item: link as NSString, typeIdentifier: UTType.plainText.identifier),
        ], message: "Watch this")], into: directory)

        let manifest = collected.manifest(id: "s2")
        XCTAssertEqual(manifest.webURL, link)
        XCTAssertEqual(manifest.text, "Watch this")
    }

    func testASharedFileIsCopiedInUnderItsCap() async throws {
        let directory = try store().makeShareDirectory(id: "s3")
        let pdf = Data("%PDF-1.4 sermon notes".utf8)
        let provider = try XCTUnwrap(NSItemProvider(contentsOf: try source("Notes.pdf", pdf)))
        // contentsOf may suggest a localized type name, such as "PDF
        // document". This sender explicitly supplies the original filename.
        provider.suggestedName = "Notes.pdf"
        let collected = await ShareCollector.collect([item([provider])], into: directory)

        let file = try XCTUnwrap(collected.files.first)
        XCTAssertEqual(file.originalName, "Notes.pdf")
        XCTAssertEqual(file.mediaType, "application/pdf")
        XCTAssertEqual(file.size, pdf.count)
        let stored = try XCTUnwrap(file.storedName)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent(stored)), pdf)
    }

    /// Finder can vend public.file-url as UTF-8 URL bytes beside generic URL
    /// and text representations. The file, rather than its local path, must
    /// reach the chat even when all three representations are advertised.
    func testFinderFileURLDataWinsOverURLAndTextRepresentations() async throws {
        let inbox = store()
        let directory = try inbox.makeShareDirectory(id: "finder-file")
        let contents = Data("Synthetic shared study notes.\n".utf8)
        let url = try source("Study notes.txt", contents)
        let fileURLData = Data(url.absoluteString.utf8)
        let provider = NSItemProvider()
        provider.suggestedName = "Study notes.txt"
        provider.registerDataRepresentation(forTypeIdentifier: UTType.fileURL.identifier, visibility: .all) { completion in
            completion(fileURLData, nil)
            return nil
        }
        provider.registerDataRepresentation(forTypeIdentifier: UTType.url.identifier, visibility: .all) { completion in
            completion(Data("https://example.com/wrong-representation".utf8), nil)
            return nil
        }
        provider.registerDataRepresentation(forTypeIdentifier: UTType.plainText.identifier, visibility: .all) { completion in
            completion(fileURLData, nil)
            return nil
        }
        let collected = await ShareCollector.collect([item([provider])], into: directory)

        XCTAssertTrue(collected.texts.isEmpty)
        XCTAssertTrue(collected.webURLs.isEmpty)
        XCTAssertEqual(collected.files.count, 1)
        let file = try XCTUnwrap(collected.files.first)
        XCTAssertEqual(file.originalName, "Study notes.txt")
        XCTAssertEqual(file.mediaType, "text/plain")
        let stored = try XCTUnwrap(file.storedName)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent(stored)), contents)
        try inbox.commit(collected.manifest(id: "finder-file"))
        let draft = try XCTUnwrap(ShareInboxIntake.takeDraft(from: inbox))
        XCTAssertEqual(draft.text, "")
        XCTAssertEqual(draft.files.map(\.filename), ["Study notes.txt"])
        XCTAssertEqual(draft.files.first?.data, contents)
        XCTAssertEqual(draft.notices, [])
    }

    func testFileURLObjectsStringsAndDataAllCopyTheFileBytes() async throws {
        let contents = Data("Actual file contents, not the URL.\n".utf8)
        let url = try source("File with spaces.txt", contents)
        let representations: [any NSSecureCoding] = [
            url as NSURL,
            url.absoluteString as NSString,
            Data(url.absoluteString.utf8) as NSData,
        ]
        for type in [UTType.fileURL, .url] {
            for (index, representation) in representations.enumerated() {
                let directory = try store().makeShareDirectory(id: "url-\(type.identifier)-\(index)")
                let provider = NSItemProvider(item: representation, typeIdentifier: type.identifier)
                let collected = await ShareCollector.collect([item([provider])], into: directory)
                XCTAssertTrue(collected.texts.isEmpty)
                XCTAssertTrue(collected.webURLs.isEmpty)
                XCTAssertEqual(collected.files.count, 1)
                let file = try XCTUnwrap(collected.files.first)
                XCTAssertEqual(file.originalName, url.lastPathComponent)
                let stored = try XCTUnwrap(file.storedName)
                XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent(stored)), contents)
            }
        }
    }

    func testWebURLDataRemainsALinkAndLocalURLTextSelectionRemainsText() async throws {
        let directory = try store().makeShareDirectory(id: "url-fallbacks")
        let webURL = "https://example.com/shared-page"
        let localURLText = "file:///tmp/selected-as-text.txt"
        let collected = await ShareCollector.collect([item([
            NSItemProvider(item: Data(webURL.utf8) as NSData, typeIdentifier: UTType.url.identifier),
            NSItemProvider(item: localURLText as NSString, typeIdentifier: UTType.plainText.identifier),
        ])], into: directory)
        XCTAssertEqual(collected.webURLs, [webURL])
        XCTAssertEqual(collected.texts, [localURLText])
        XCTAssertTrue(collected.files.isEmpty)
    }

    func testUnreadableFileURLIsReportedAsAFileWithoutLeakingItsPathIntoTheMessage() async throws {
        let directory = try store().makeShareDirectory(id: "unreadable-file-url")
        let url = base.appendingPathComponent("Missing.txt")
        let provider = NSItemProvider(item: Data(url.absoluteString.utf8) as NSData, typeIdentifier: UTType.fileURL.identifier)
        let collected = await ShareCollector.collect([item([provider])], into: directory)
        XCTAssertTrue(collected.texts.isEmpty)
        XCTAssertTrue(collected.webURLs.isEmpty)
        XCTAssertEqual(collected.files.count, 1)
        XCTAssertEqual(collected.files.first?.originalName, "Missing.txt")
        XCTAssertNil(collected.files.first?.storedName)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
    }

    /// Text files are capped at 1 MB: one byte over is listed without bytes,
    /// so the chat says why, and no partial copy is left in the share.
    func testAFileOverItsCapIsListedWithoutBytesAndLeavesNothing() async throws {
        let directory = try store().makeShareDirectory(id: "s4")
        let big = Data(repeating: 0x61, count: AttachmentLimits.maxTextBytes + 1)
        let url = try source("Transcript.txt", big)
        // A text file shared as a file URL, as Files/Finder provides it.
        // contentsOf can vend its contents as a text selection instead,
        // which intentionally goes into the composer rather than a file.
        let provider = NSItemProvider(item: url as NSURL, typeIdentifier: UTType.fileURL.identifier)
        provider.suggestedName = "Transcript.txt"
        let collected = await ShareCollector.collect([item([provider])], into: directory)

        XCTAssertTrue(collected.texts.isEmpty)
        XCTAssertEqual(collected.files.count, 1)
        let file = try XCTUnwrap(collected.files.first)
        XCTAssertEqual(file.originalName, "Transcript.txt")
        XCTAssertNil(file.storedName)
        XCTAssertGreaterThan(file.size ?? 0, AttachmentLimits.maxTextBytes)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
    }

    func testAShareWithNothingUsableIsEmpty() async throws {
        let directory = try store().makeShareDirectory(id: "s5")
        let collected = await ShareCollector.collect([item([
            NSItemProvider(item: "   " as NSString, typeIdentifier: UTType.plainText.identifier),
        ])], into: directory)
        XCTAssertTrue(collected.isEmpty)
    }

    /// Collected, committed and taken: the chat the app opens from it.
    func testACollectedShareOpensAsAChatDraft() async throws {
        let inbox = store()
        let directory = try inbox.makeShareDirectory(id: "s6")
        let audio = Data(repeating: 1, count: 4096)
        let provider = try XCTUnwrap(NSItemProvider(contentsOf: try source("Voice memo.m4a", audio)))
        provider.suggestedName = "Voice memo.m4a"
        let collected = await ShareCollector.collect([item([
            provider,
            NSItemProvider(item: "Is this sound doctrine?" as NSString, typeIdentifier: UTType.plainText.identifier),
        ])], into: directory)
        try inbox.commit(collected.manifest(id: "s6"))

        let draft = try XCTUnwrap(ShareInboxIntake.takeDraft(from: inbox))
        XCTAssertEqual(draft.text, "Is this sound doctrine?")
        XCTAssertEqual(draft.files.map(\.filename), ["Voice memo.m4a"])
        XCTAssertEqual(draft.notices, [])
        XCTAssertFalse(inbox.hasPending)
    }

    // MARK: Which form of a file

    func testAFileFormWinsOverTheLinkAndTextForms() {
        XCTAssertEqual(ShareCollector.fileType(among: [.url, .plainText, .pdf]), .pdf)
        XCTAssertNil(ShareCollector.fileType(among: [.url, .plainText]))
    }

    /// iOS keeps the first file form, since the app re-encodes photos; the
    /// Mac attaches images as they are, so it takes Photos' JPEG over HEIC.
    func testTheAllowlistedFormIsPreferredOnlyOnTheMac() {
        XCTAssertTrue(ShareCollector.isAllowlisted(.jpeg))
        XCTAssertTrue(ShareCollector.isAllowlisted(.mpeg4Audio))
        XCTAssertFalse(ShareCollector.isAllowlisted(.heic))
#if os(macOS)
        XCTAssertEqual(ShareCollector.fileType(among: [.heic, .jpeg]), .jpeg)
#else
        XCTAssertEqual(ShareCollector.fileType(among: [.heic, .jpeg]), .heic)
#endif
        XCTAssertEqual(ShareCollector.fileType(among: [.heic]), .heic)
    }

    // MARK: Inboxes

    func testTheIOSAppGroupIsUnchanged() {
#if os(iOS)
        XCTAssertEqual(PendingShare.appGroupID, "group.com.spragginsdesigns.sureword")
#else
        XCTAssertEqual(PendingShare.appGroupID, "389LLKGY3Y.group.com.spragginsdesigns.sureword")
#endif
    }

    private func commit(_ text: String, at date: Date, in inbox: PendingShareStore) throws {
        let id = UUID().uuidString
        _ = try inbox.makeShareDirectory(id: id)
        try inbox.commit(PendingShareCollection(texts: [text]).manifest(id: id, now: date))
    }

    func testNewestPendingDateReadsTheManifestsOnly() throws {
        let inbox = store()
        XCTAssertNil(inbox.newestPendingDate)
        let date = Date(timeIntervalSince1970: 1_791_000_000)
        try commit("hello", at: date, in: inbox)
        XCTAssertEqual(inbox.newestPendingDate?.timeIntervalSince1970 ?? 0, date.timeIntervalSince1970, accuracy: 1)
        XCTAssertTrue(inbox.hasPending, "reading the date does not take the share")
    }

    /// The Mac's Services menu and drops write one inbox and its Share
    /// extension another; the newest share opens, whichever wrote it, and
    /// both are emptied so the older never opens later.
    func testTheNewestShareAcrossInboxesWinsAndBothEmpty() throws {
        let app = store("App")
        let group = store("Group")
        let now = Date()
        for (older, newer) in [(app, group), (group, app)] {
            try commit("older", at: now.addingTimeInterval(-60), in: older)
            try commit("newer", at: now, in: newer)

            XCTAssertEqual(PendingShareStore.takeNewest(from: [app, group], now: now)?.text, "newer")
            XCTAssertFalse(app.hasPending)
            XCTAssertFalse(group.hasPending)
            XCTAssertNil(PendingShareStore.takeNewest(from: [app, group], now: now))
        }
    }

    func testAnEmptyInboxBesideAWaitingOneIsNoObstacle() throws {
        let app = store("App")
        let group = store("Group")
        try commit("only one", at: Date(), in: group)
        XCTAssertEqual(PendingShareStore.takeNewest(from: [app, group])?.text, "only one")
    }
}
