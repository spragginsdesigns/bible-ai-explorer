import Foundation

/// "Share into SureWord" on iOS: the hand-off between the share extension and
/// the app, through the App Group container both are entitled to.
///
/// Compiled into both targets (`SureWord-iOS` and `SureWord-iOS-Share`), so it
/// is Foundation only and extension-safe. The extension writes one share as a
/// folder - the shared files copied in, plus `manifest.json` describing them -
/// and the app takes it when it next has a signed-in chat to open it in. The
/// share is on disk, not in memory, so it waits through a cold start and through
/// sign-in (Android holds it in memory, which covers sign-in but not a killed
/// process).
///
/// Layout: `<container>/PendingShares/<share id>/manifest.json` and the files
/// beside it. A newer share replaces any older one that was never opened, the
/// same rule as Android's `shareInbox.ts`.
enum PendingShare {
    static let appGroupID = "group.com.spragginsdesigns.sureword"
    /// Opened by the extension after it saves; the app treats it as "look in
    /// the inbox now". Never carries the share itself.
    static let openURL = URL(string: "sureword://share")!
    static let manifestFilename = "manifest.json"
    /// A share nobody opened within a day is dropped rather than surprising the
    /// user with it a week later.
    static let maxAge: TimeInterval = 24 * 60 * 60
}

/// What the extension saw, written as `manifest.json`. Versioned so a newer
/// extension's manifest that this app cannot read is discarded, not misread.
struct PendingShareManifest: Codable, Equatable, Sendable {
    static let currentVersion = 1

    var version: Int = Self.currentVersion
    var id: String
    var createdAt: Date
    /// Plain text the sharing app handed over (a message, a selection).
    var text: String?
    /// A web page, from Safari or a link share.
    var webURL: String?
    var files: [File]

    struct File: Codable, Equatable, Sendable {
        /// The copy's name inside the share folder; nil when the file was not
        /// copied (too large to be worth moving), so the app can still say why.
        var storedName: String?
        /// What the sharing app called it, which is what the chip shows.
        var originalName: String?
        /// The uniform type identifier the provider declared.
        var typeIdentifier: String?
        /// The MIME type of that identifier, when the system knows one.
        var mediaType: String?
        var size: Int?
    }

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

/// A share read back out of the inbox, file bytes loaded. `data` is nil for a
/// file the extension listed but could not (or chose not to) copy.
struct ReceivedShare: Equatable, Sendable {
    var text: String?
    var webURL: String?
    var files: [File]

    struct File: Equatable, Sendable {
        var name: String?
        var typeIdentifier: String?
        var mediaType: String?
        var size: Int?
        var data: Data?
    }
}

/// The inbox on disk. `root` is injectable so tests run against a temporary
/// directory instead of the App Group container.
struct PendingShareStore: Sendable {
    let root: URL

    init(root: URL) {
        self.root = root
    }

    /// The App Group inbox, or nil when the process is not entitled to the
    /// group (a build signed without the App Group capability).
    static func appGroup() -> PendingShareStore? {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: PendingShare.appGroupID
        ) else { return nil }
        return PendingShareStore(root: container.appendingPathComponent("PendingShares", isDirectory: true))
    }

    // MARK: Extension side

    /// A fresh folder for a share being written. Nothing reads it until
    /// `commit` writes its manifest, so a half-written share is never taken.
    func makeShareDirectory(id: String) throws -> URL {
        let directory = root.appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// Write the manifest last, atomically, then drop every older share: a
    /// newer share replaces an unopened older one.
    func commit(_ manifest: PendingShareManifest) throws {
        let directory = root.appendingPathComponent(manifest.id, isDirectory: true)
        let data = try PendingShareManifest.encoder().encode(manifest)
        try data.write(to: directory.appendingPathComponent(PendingShare.manifestFilename), options: .atomic)
        for other in shareDirectories() where other.lastPathComponent != manifest.id {
            try? FileManager.default.removeItem(at: other)
        }
    }

    /// Abandon a share that failed part-way through being written.
    func discard(id: String) {
        try? FileManager.default.removeItem(at: root.appendingPathComponent(id, isDirectory: true))
    }

    // MARK: App side

    /// True when a committed share is waiting. Cheap: reads no file bytes.
    var hasPending: Bool {
        shareDirectories().contains { directory in
            FileManager.default.fileExists(
                atPath: directory.appendingPathComponent(PendingShare.manifestFilename).path
            )
        }
    }

    /// Hand the newest committed share to exactly one caller and empty the
    /// inbox. Expired, unreadable and newer-version shares are deleted on the
    /// way, so the inbox never fills with junk it cannot open.
    func take(now: Date = Date()) -> ReceivedShare? {
        var newest: (manifest: PendingShareManifest, directory: URL)?
        var finished: [URL] = []

        for directory in shareDirectories() {
            let manifestURL = directory.appendingPathComponent(PendingShare.manifestFilename)
            guard let data = try? Data(contentsOf: manifestURL) else {
                // Still being written by the extension, unless it is old enough
                // that the extension clearly died part-way.
                if let created = creationDate(of: directory), now.timeIntervalSince(created) > PendingShare.maxAge {
                    finished.append(directory)
                }
                continue
            }
            finished.append(directory)
            guard let manifest = try? PendingShareManifest.decoder().decode(PendingShareManifest.self, from: data),
                  manifest.version <= PendingShareManifest.currentVersion,
                  now.timeIntervalSince(manifest.createdAt) <= PendingShare.maxAge
            else { continue }
            if newest == nil || manifest.createdAt > newest!.manifest.createdAt {
                newest = (manifest, directory)
            }
        }

        let share = newest.map { Self.read($0.manifest, in: $0.directory) }
        for directory in finished {
            try? FileManager.default.removeItem(at: directory)
        }
        return share
    }

    private static func read(_ manifest: PendingShareManifest, in directory: URL) -> ReceivedShare {
        ReceivedShare(
            text: manifest.text,
            webURL: manifest.webURL,
            files: manifest.files.map { file in
                // A stored name is only ever a bare file name; never follow one
                // that tries to leave the share folder.
                let data = file.storedName
                    .flatMap { name -> String? in
                        name.isEmpty || name.contains("/") || name == ".." || name == "." ? nil : name
                    }
                    .flatMap { try? Data(contentsOf: directory.appendingPathComponent($0)) }
                return ReceivedShare.File(
                    name: file.originalName,
                    typeIdentifier: file.typeIdentifier,
                    mediaType: file.mediaType,
                    size: file.size ?? data?.count,
                    data: data
                )
            }
        )
    }

    private func shareDirectories() -> [URL] {
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey, .creationDateKey]
        )) ?? []
        return contents.filter {
            (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        }
    }

    private func creationDate(of url: URL) -> Date? {
        try? url.resourceValues(forKeys: [.creationDateKey]).creationDate
    }
}
