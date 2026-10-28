import AppKit
import Foundation
import UniformTypeIdentifiers

/// What another app handed the Mac: text, a web page's link, and files. Read
/// from the Services pasteboard or from dropped and opened URLs. Pure, so the
/// sorting rules are pinned by tests.
struct MacSharedItems: Equatable, Sendable {
    var texts: [String] = []
    var links: [URL] = []
    var files: [URL] = []

    /// Nothing worth a chat: no text with words in it, no link, no file.
    var isEmpty: Bool {
        links.isEmpty && files.isEmpty
            && texts.allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    /// Dropped or opened URLs. Files are attached and a web page becomes the
    /// link; any other URL (`mailto:`, another app's scheme) is not a share.
    init(texts: [String] = [], urls: [URL]) {
        self.texts = texts
        files = urls.filter(\.isFileURL)
        links = urls.filter { ["http", "https"].contains($0.scheme?.lowercased() ?? "") }
    }

    /// The Services pasteboard: the files selected in Finder as file URLs, or
    /// the text selected in another app. Finder can put the files' paths on
    /// the pasteboard as text as well, so text is read only when no file is
    /// there. Read the same way as the composer's paste
    /// (`ChatInputBar.pasteboardAttachments`).
    init(pasteboard: NSPasteboard) {
        let urls = (pasteboard.readObjects(forClasses: [NSURL.self]) as? [URL]) ?? []
        self.init(urls: urls)
        if files.isEmpty, let text = pasteboard.string(forType: .string) {
            texts = [text]
        }
    }
}

/// "Share into SureWord" on the Mac. The Services menu entry, a drop on the
/// window and a drop on the Dock icon (or Open With) all write one share into
/// the same inbox the iOS share extension writes (`ShareInbox/`): the text and
/// the link in the manifest, the files copied in under their caps by
/// `PendingShareCopy`. The Share menu's SureWord extension
/// (`SureWord-macOS-Share`) writes the same kind of share into the App Group
/// container. The signed-in window then opens the newest of them exactly as
/// iOS does (`ShareInboxIntake`, then `ChatViewModel.startSharedChat`): a new
/// chat with the text in the composer, the files attached, and Check against
/// Scripture and Help me reply. The share is on disk, so one made signed out
/// waits through sign-in, as on Android.
@MainActor
final class MacShareInbox {
    static let shared = MacShareInbox(store: MacShareInbox.defaultStore(), extensionStore: .appGroup())

    /// `<Application Support>/SureWord/PendingShares`, beside the app's other
    /// files, for what the app receives itself. Not the App Group container:
    /// the app writes this one in every build, signed or not, and only the
    /// extension needs the group.
    nonisolated static func defaultStore() -> PendingShareStore? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        else { return nil }
        return PendingShareStore(root: base.appendingPathComponent("SureWord/PendingShares", isDirectory: true))
    }

    let store: PendingShareStore?
    /// The Share extension's inbox in the App Group container; nil in a build
    /// whose signature does not carry the group (`PendingShareStore.appGroup`).
    let extensionStore: PendingShareStore?
    /// How long files opened together are gathered into one share.
    private let gatherDelay: Duration
    private var openedFiles: [URL] = []
    private var gathering: Task<Void, Never>?
    /// The latest write. Each waits for the one before it, because committing
    /// a share removes every other share folder, one still being written
    /// included; in order, the newest share is the one left.
    private var saving: Task<Void, Never>?
    /// A share is being read off disk. One guard for the app, not one per
    /// window, so two windows never both open the same share.
    private var isTaking = false

    init(
        store: PendingShareStore?,
        extensionStore: PendingShareStore? = nil,
        gatherDelay: Duration = .milliseconds(300)
    ) {
        self.store = store
        self.extensionStore = extensionStore
        self.gatherDelay = gatherDelay
        guard extensionStore != nil else { return }
        // The extension saves, then opens `sureword://share` with this app,
        // which brings it forward: coming forward is when to look, whether
        // the app was already running or that URL just launched it (the
        // window looks on appearing too).
        NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.extensionShareArrived() }
        }
    }

    /// `sureword://share`, the extension's "look in the inbox now". It never
    /// carries the share itself, and the window opens whatever is waiting.
    func extensionShareArrived() {
        guard extensionStore?.hasPending == true else { return }
        NotificationCenter.default.post(name: .pendingShareArrived, object: nil)
    }

    /// Save one share, then tell the window and bring SureWord forward. The
    /// copy (up to five files, maybe from a network volume) runs off the main
    /// actor. False when there is nothing in it to save, so a drop is refused
    /// and the Services request reports an error.
    @discardableResult
    func receive(_ items: MacSharedItems) -> Bool {
        guard let store, !items.isEmpty else { return false }
        let previous = saving
        saving = Task {
            await previous?.value
            let saved = await Task.detached(priority: .userInitiated) {
                Self.save(items, in: store)
            }.value
            guard saved else { return }
            NotificationCenter.default.post(name: .pendingShareArrived, object: nil)
            NSApp.activate()
        }
        return true
    }

    /// A file dropped on the Dock icon or opened with SureWord. SwiftUI hands
    /// these to `onOpenURL` one URL at a time, and a newer share replaces an
    /// unopened older one, so files that arrive together are gathered into one
    /// share: three files dropped at once open one chat with three attached.
    func open(fileURL url: URL) {
        openedFiles.append(url)
        guard gathering == nil else { return }
        let delay = gatherDelay
        gathering = Task { [weak self] in
            try? await Task.sleep(for: delay)
            self?.saveOpenedFiles()
        }
    }

    /// Waits until everything received so far is written: files still being
    /// gathered, then the writes themselves.
    func finishSaving() async {
        await gathering?.value
        await saving?.value
    }

    /// The waiting share as a chat draft, or nil when there is none (or it is
    /// already being opened). The newest of the app's own inbox and the Share
    /// extension's wins; taking empties both. The read, up to five files, runs
    /// off the main actor.
    func takeDraft() async -> SharedChatDraft? {
        let stores = [store, extensionStore].compactMap { $0 }.filter(\.hasPending)
        guard !isTaking, !stores.isEmpty else { return nil }
        isTaking = true
        defer { isTaking = false }
        return await Task.detached(priority: .userInitiated) {
            PendingShareStore.takeNewest(from: stores).map(ShareInboxIntake.draft(for:))
        }.value
    }

    private func saveOpenedFiles() {
        let files = openedFiles
        openedFiles = []
        gathering = nil
        receive(MacSharedItems(urls: files))
    }

    /// Write one share the way the iOS extension does: a folder, the files
    /// copied in under their caps, the manifest last (a newer share replaces
    /// an unopened older one). A file too large or unreadable is listed
    /// without bytes, so the chat can say why it was left out.
    nonisolated static func save(
        _ items: MacSharedItems,
        in store: PendingShareStore,
        id: String = UUID().uuidString,
        now: Date = Date()
    ) -> Bool {
        guard !items.isEmpty, let directory = try? store.makeShareDirectory(id: id) else { return false }
        var collection = PendingShareCollection(texts: items.texts, webURLs: items.links.map(\.absoluteString))
        for (offset, url) in items.files.enumerated() {
            collection.files.append(PendingShareCopy.file(
                from: url,
                // The extension's rule for a file URL (`ShareCollector`).
                type: UTType(filenameExtension: url.pathExtension) ?? .data,
                suggestedName: nil,
                index: offset + 1,
                into: directory
            ))
        }
        guard !collection.isEmpty, (try? store.commit(collection.manifest(id: id, now: now))) != nil else {
            store.discard(id: id)
            return false
        }
        return true
    }
}

extension AppDelegate {
    /// The Services menu entry "Share into SureWord" (`NSServices` in
    /// `project.yml`, `NSMessage` `shareIntoSureWord`). AppKit sends
    /// `shareIntoSureWord:userData:error:` on the main thread with the text
    /// selected in another app, or the files selected in Finder.
    @MainActor
    @objc func shareIntoSureWord(
        _ pasteboard: NSPasteboard,
        userData: String?,
        error: AutoreleasingUnsafeMutablePointer<NSString?>
    ) {
        guard MacShareInbox.shared.receive(MacSharedItems(pasteboard: pasteboard)) else {
            error.pointee = "Nothing in that selection could be opened in SureWord." as NSString
            return
        }
    }
}
