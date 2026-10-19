import AppKit
import XCTest

@testable import SureWord

/// "Share into SureWord" on the Mac (LC-16621): what the Services menu and
/// drops on the window or Dock icon hand over, how it is written to the same
/// inbox the iOS share extension uses, and how the window takes it back as a
/// chat draft. The inbox, the bounded copy and the planner themselves are
/// pinned by the iOS suite (`ShareIntoSureWordTests`); these cases are the
/// Mac's half.
final class ShareIntoSureWordMacTests: XCTestCase {
    private var root: URL!
    private var files: URL!

    override func setUpWithError() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("mac-share-tests-\(UUID().uuidString)", isDirectory: true)
        root = base.appendingPathComponent("PendingShares", isDirectory: true)
        files = base.appendingPathComponent("Desktop", isDirectory: true)
        try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root.deletingLastPathComponent())
    }

    private var store: PendingShareStore { PendingShareStore(root: root) }

    /// A file on the "desktop" to share.
    private func file(_ name: String, _ data: Data) throws -> URL {
        let url = files.appendingPathComponent(name)
        try data.write(to: url)
        return url
    }

    /// A private pasteboard standing in for the one AppKit hands a service.
    private func withPasteboard(_ body: (NSPasteboard) throws -> Void) rethrows {
        let pasteboard = NSPasteboard(name: NSPasteboard.Name("sureword-tests-\(UUID().uuidString)"))
        defer { pasteboard.releaseGlobally() }
        pasteboard.clearContents()
        try body(pasteboard)
    }

    // MARK: What arrived

    func testDroppedURLsSortIntoFilesAndLinks() {
        let doc = URL(fileURLWithPath: "/Users/me/Desktop/Sermon notes.pdf")
        let items = MacSharedItems(urls: [
            doc,
            URL(string: "https://youtu.be/GMwihA5jnhY")!,
            URL(string: "mailto:pastor@example.com")!,
            URL(string: "HTTP://example.com/post")!,
        ])
        XCTAssertEqual(items.files, [doc])
        XCTAssertEqual(items.links.map(\.absoluteString), ["https://youtu.be/GMwihA5jnhY", "HTTP://example.com/post"])
        XCTAssertEqual(items.texts, [])
        XCTAssertFalse(items.isEmpty)
    }

    func testNothingUsableIsNotAShare() {
        XCTAssertTrue(MacSharedItems(urls: []).isEmpty)
        XCTAssertTrue(MacSharedItems(texts: ["  \n "], urls: [URL(string: "mailto:a@b.c")!]).isEmpty)
        XCTAssertFalse(MacSharedItems(texts: ["Is this biblical?"], urls: []).isEmpty)
    }

    func testServicesTextSelection() {
        withPasteboard { pasteboard in
            pasteboard.setString("Karma is in the Bible, right?", forType: .string)
            let items = MacSharedItems(pasteboard: pasteboard)
            XCTAssertEqual(items.texts, ["Karma is in the Bible, right?"])
            XCTAssertEqual(items.files, [])
            XCTAssertEqual(items.links, [])
        }
    }

    /// Finder can offer the selected files' paths as text too; the files win.
    func testServicesFinderFilesWinOverTheirPaths() throws {
        let voice = try file("voice.m4a", Data("ftyp".utf8))
        withPasteboard { pasteboard in
            pasteboard.writeObjects([voice as NSURL])
            pasteboard.setString(voice.path, forType: .string)
            let items = MacSharedItems(pasteboard: pasteboard)
            XCTAssertEqual(items.files.map(\.lastPathComponent), ["voice.m4a"])
            XCTAssertEqual(items.texts, [])
        }
    }

    func testAnEmptyServicesPasteboardIsNotAShare() {
        withPasteboard { pasteboard in
            XCTAssertTrue(MacSharedItems(pasteboard: pasteboard).isEmpty)
        }
    }

    // MARK: Into the inbox and back out

    func testASavedShareOpensAsTheSameDraftIOSWouldOpen() throws {
        let notes = try file("notes.txt", Data("Matthew 7:1".utf8))
        let voice = try file("New Recording.m4a", Data(repeating: 1, count: 64))
        let items = MacSharedItems(
            texts: ["What do you make of this?"],
            urls: [notes, URL(string: "https://example.com/post")!, voice]
        )
        XCTAssertTrue(MacShareInbox.save(items, in: store, id: "mac-1"))
        XCTAssertTrue(store.hasPending)

        let draft = try XCTUnwrap(ShareInboxIntake.takeDraft(from: store))
        XCTAssertEqual(draft.text, "What do you make of this?\n\nhttps://example.com/post")
        XCTAssertEqual(draft.files.map(\.filename), ["notes.txt", "New Recording.m4a"])
        XCTAssertEqual(draft.files.map(\.mediaType), ["text/plain", "audio/mp4"])
        XCTAssertEqual(draft.notices, [])
        XCTAssertNil(ShareInboxIntake.takeDraft(from: store), "a share is opened exactly once")
        XCTAssertTrue(FileManager.default.fileExists(atPath: notes.path), "the user's own file is copied, never moved")
    }

    /// The copy stops at the cap whatever the file claims (security scan
    /// 2026-10-09, #8), so the chat says why it was left out.
    func testAFileOverItsCapIsExplainedNotCopied() throws {
        let big = try file("big.txt", Data(repeating: 65, count: AttachmentLimits.maxTextBytes + 1))
        XCTAssertTrue(MacShareInbox.save(MacSharedItems(urls: [big]), in: store, id: "mac-big"))
        let stored = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("mac-big").path)
        XCTAssertEqual(stored, [PendingShare.manifestFilename], "nothing over the cap lands in the inbox")

        let draft = try XCTUnwrap(ShareInboxIntake.takeDraft(from: store))
        XCTAssertEqual(draft.files, [])
        XCTAssertEqual(draft.notices, ["big.txt exceeds the 1 MB file limit."])
    }

    func testAFileGoneBeforeItIsReadIsExplained() throws {
        let missing = files.appendingPathComponent("gone.pdf")
        XCTAssertTrue(MacShareInbox.save(MacSharedItems(urls: [missing]), in: store))
        let draft = try XCTUnwrap(ShareInboxIntake.takeDraft(from: store))
        XCTAssertEqual(draft.notices, ["gone.pdf is empty or unreadable."])
    }

    func testAFolderIsExplainedNotAttached() throws {
        let folder = files.appendingPathComponent("Sermons", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        XCTAssertTrue(MacShareInbox.save(MacSharedItems(urls: [folder]), in: store))
        let draft = try XCTUnwrap(ShareInboxIntake.takeDraft(from: store))
        XCTAssertEqual(draft.files, [])
        XCTAssertEqual(draft.notices.count, 1)
        XCTAssertTrue(draft.notices[0].contains("Sermons"), draft.notices[0])
    }

    func testNothingUsableSavesNothing() throws {
        XCTAssertFalse(MacShareInbox.save(MacSharedItems(texts: [" "], urls: [URL(string: "mailto:a@b.c")!]), in: store))
        XCTAssertFalse(store.hasPending)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path), "no empty share folder is left behind")
    }

    /// The Mac goes by the file's extension like its own picker, so a WebM
    /// voice note (which the system calls video/webm) attaches as audio, and
    /// images are attached as they are (only iOS re-encodes Photos' HEIC).
    func testTheMacAttachesFilesAsItsPickerDoes() {
        let audio = Data([0x1A, 0x45, 0xDF, 0xA3])
        let draft = ShareInboxIntake.draft(for: ReceivedShare(text: nil, webURL: nil, files: [
            .init(name: "voice.webm", typeIdentifier: "org.webmproject.webm", mediaType: "video/webm", size: 4, data: audio),
        ]))
        XCTAssertEqual(draft.files.map(\.mediaType), ["audio/webm"])

        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        let incoming = ShareInboxIntake.incomingFile(.init(
            name: "Screenshot.png", typeIdentifier: "public.png", mediaType: "image/png", size: png.count, data: png
        ))
        XCTAssertEqual(incoming, IncomingSharedFile(filename: "Screenshot.png", mediaType: nil, data: png, size: png.count))
    }

    // MARK: The inbox object

    /// Signed out there is no window to open it, so the share waits on disk
    /// and the window takes it once, right after sign-in.
    @MainActor
    func testAShareWaitsUntilTheWindowTakesIt() async throws {
        let inbox = MacShareInbox(store: store)
        XCTAssertTrue(MacShareInbox.save(MacSharedItems(texts: ["Shared while signed out"], urls: []), in: store))
        XCTAssertTrue(store.hasPending)
        XCTAssertTrue(store.hasPending, "checking does not consume")

        let draft = await inbox.takeDraft()
        XCTAssertEqual(draft?.text, "Shared while signed out")
        let again = await inbox.takeDraft()
        XCTAssertNil(again)
    }

    /// Every window observes the inbox; two asking at once open it once.
    @MainActor
    func testTwoWindowsAskingAtOnceOpenTheShareOnce() async throws {
        let inbox = MacShareInbox(store: store)
        XCTAssertTrue(MacShareInbox.save(MacSharedItems(texts: ["once"], urls: []), in: store))
        async let first = inbox.takeDraft()
        async let second = inbox.takeDraft()
        let drafts = await [first, second].compactMap { $0 }
        XCTAssertEqual(drafts.map(\.text), ["once"])
    }

    /// The Dock hands files over one `onOpenURL` call at a time; files that
    /// arrive together are one share, not each replacing the last.
    @MainActor
    func testFilesOpenedTogetherAreOneShare() async throws {
        let inbox = MacShareInbox(store: store, gatherDelay: .milliseconds(50))
        let names = ["a.pdf", "b.txt", "c.png"]
        for name in names {
            inbox.open(fileURL: try file(name, Data("x".utf8)))
        }
        XCTAssertFalse(store.hasPending, "still gathering")
        await inbox.finishSaving()

        let share = try XCTUnwrap(store.take())
        XCTAssertEqual(share.files.compactMap(\.name), names)
        XCTAssertNil(store.take())
    }

    /// Shares received back to back are written in order, so the newest is
    /// the one waiting and no half-written folder is left behind.
    @MainActor
    func testBackToBackSharesLeaveTheNewest() async throws {
        let inbox = MacShareInbox(store: store)
        let files = try (1...5).map { try file("page\($0).pdf", Data(repeating: 7, count: 256 * 1024)) }
        XCTAssertTrue(inbox.receive(MacSharedItems(texts: ["first"], urls: files)))
        XCTAssertTrue(inbox.receive(MacSharedItems(texts: ["second"], urls: [])))
        XCTAssertFalse(inbox.receive(MacSharedItems(texts: ["  "], urls: [])), "nothing to save is refused at once")
        await inbox.finishSaving()

        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path).count, 1)
        XCTAssertEqual(store.take()?.text, "second")
        XCTAssertFalse(store.hasPending)
    }

    func testTheInboxLivesInApplicationSupport() throws {
        let root = try XCTUnwrap(MacShareInbox.defaultStore()?.root)
        XCTAssertTrue(root.path.hasSuffix("/Application Support/SureWord/PendingShares"), root.path)
    }

    // MARK: The Services entry

    /// `NSMessage` names the method AppKit calls; a typo on either side means
    /// the menu item silently does nothing.
    @MainActor
    func testTheServicesEntryMatchesTheHandler() async throws {
        let info = try XCTUnwrap(Bundle(for: AppDelegate.self).infoDictionary)
        let services = try XCTUnwrap(info["NSServices"] as? [[String: Any]])
        let entry = try XCTUnwrap(services.first)
        XCTAssertEqual((entry["NSMenuItem"] as? [String: String])?["default"], "Share into SureWord")
        let message = try XCTUnwrap(entry["NSMessage"] as? String)
        XCTAssertTrue(AppDelegate().responds(to: NSSelectorFromString("\(message):userData:error:")))
        XCTAssertNotNil(entry["NSRequiredContext"], "without it the item is registered but never shown")

        let documents = try XCTUnwrap(info["CFBundleDocumentTypes"] as? [[String: Any]])
        XCTAssertEqual(documents.first?["LSHandlerRank"] as? String, "None", "accept drops, never become the default opener")
    }
}
