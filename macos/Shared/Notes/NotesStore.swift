import Foundation

/// Shared, persisted cache for the notes library — a port of
/// `mobile/src/features/notes/notesStore.ts`.
///
/// Both the list and the editor read and write through this one object, so:
///
/// - the list renders the last snapshot instantly and revalidates silently;
/// - opening a note whose body has been seen before shows no spinner;
/// - an edit in the editor is visible in the list immediately.
///
/// List fetches return summary rows with no body. Bodies are merged in from
/// single-note fetches and saves, and `hasBody` marks the entries whose body
/// fields are real rather than summary placeholders.
@MainActor
@Observable
final class NotesStore {
    /// The app-wide instance. A single cache is the point: two would let the
    /// list and the editor disagree about the same note.
    static let shared = NotesStore(cacheURL: NotesStore.defaultCacheURL)

    private(set) var notes: [Note] = []
    private(set) var folders: [Folder] = []
    private(set) var tags: [Tag] = []
    /// True once the persisted cache has been read, or found absent.
    private(set) var isHydrated = false

    /// Invalidates every in-flight cache consumer on sign-out/account changes.
    private(set) var epoch = UUID()
    private(set) var accountID: String?

    /// The store holds a weak token: closing/deallocating its model cannot
    /// leave a stale lock behind, and a second window cannot become a writer.
    final class EditingLease {
        let id = UUID()
    }
    private final class WeakLease {
        weak var value: EditingLease?
        init(_ value: EditingLease) { self.value = value }
    }
    @ObservationIgnored private var editingLeases: [String: WeakLease] = [:]
    /// Retain only the last grant's identity after its weak lease expires. A
    /// closed editor may finish its canonical read until another editor opens
    /// this note; that handoff permanently invalidates its outstanding reads.
    @ObservationIgnored private var lastEditingLeaseIDs: [String: UUID] = [:]

    func claimEditingLease(noteID: String, epoch expected: UUID) -> EditingLease? {
        guard isCurrent(expected), editingLeases[noteID]?.value == nil else { return nil }
        let lease = EditingLease()
        editingLeases[noteID] = WeakLease(lease)
        lastEditingLeaseIDs[noteID] = lease.id
        return lease
    }

    func canAdoptCanonical(leaseID: UUID?, noteID: String, epoch expected: UUID) -> Bool {
        guard isCurrent(expected), let leaseID else { return false }
        return lastEditingLeaseIDs[noteID] == leaseID
    }

    func canMutateUnopenedNote(noteID: String, epoch expected: UUID) -> Bool {
        isCurrent(expected) && editingLeases[noteID]?.value == nil && pendingAttempt(noteID: noteID) == nil && recoveryLedgerError == nil
    }

    func ownsEditingLease(_ lease: EditingLease?, noteID: String, epoch expected: UUID) -> Bool {
        guard isCurrent(expected), let lease else { return false }
        return editingLeases[noteID]?.value === lease
    }

    struct AIAttempt: Codable, Equatable, Sendable {
        enum OperationProtocol: String, Codable, Sendable { case legacy, operationReceipt }
        var id: String
        var userMessageID: String
        var responseMessageID: String?
        var terminal = false
        var operationProtocol: OperationProtocol = .legacy

        init(id: String, userMessageID: String, responseMessageID: String? = nil, terminal: Bool = false, operationProtocol: OperationProtocol = .legacy) {
            self.id = id
            self.userMessageID = userMessageID
            self.responseMessageID = responseMessageID
            self.terminal = terminal
            self.operationProtocol = operationProtocol
        }

        private enum CodingKeys: String, CodingKey { case id, userMessageID, responseMessageID, terminal, operationProtocol }

        init(from decoder: any Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            id = try values.decode(String.self, forKey: .id)
            userMessageID = try values.decode(String.self, forKey: .userMessageID)
            responseMessageID = try values.decodeIfPresent(String.self, forKey: .responseMessageID)
            terminal = try values.decodeIfPresent(Bool.self, forKey: .terminal) ?? false
            // Older ledgers have no server fence. Their UUIDs must never be
            // sent to the operation cancellation endpoint.
            operationProtocol = try values.decodeIfPresent(OperationProtocol.self, forKey: .operationProtocol) ?? .legacy
        }
    }
    @ObservationIgnored private var reconciledAI: [String: String] = [:]
    @ObservationIgnored private var pendingAI: [String: [String: AIAttempt]] = [:]
    @ObservationIgnored private let ledgerURL: URL?
    @ObservationIgnored private let allowsEphemeralLedger: Bool
    @ObservationIgnored private var hasSeenLedgerFile = false
    private(set) var recoveryLedgerError: String?

    private static let ledgerNotice = "The saved AI safety status could not be read. Editing is paused. Check again after restoring access to app storage; you can still copy the visible note as Markdown."

    func bindAccount(_ accountID: String?) {
        guard self.accountID != accountID else { return }
        invalidateSession()
        notes = []; folders = []; tags = []
        self.accountID = accountID
        loadLedger()
    }

    func isCurrent(_ expected: UUID) -> Bool { epoch == expected }

    private func invalidateSession() {
        epoch = UUID()
        editingLeases = [:]
        lastEditingLeaseIDs = [:]
        reconciledAI = [:]
        hydrateTask?.cancel()
        hydrateTask = nil
        isHydrated = false
    }

    func pendingAttempt(noteID: String) -> AIAttempt? {
        pendingAI[accountID ?? "unbound"]?[noteID]
    }

    @discardableResult
    func recordAttempt(_ attempt: AIAttempt?, noteID: String, epoch expected: UUID, expectedAttemptID: String? = nil) -> Bool {
        guard isCurrent(expected), recoveryLedgerError == nil else { return false }
        let owner = accountID ?? "unbound"
        let previous = pendingAI[owner]
        guard previous?[noteID]?.id == expectedAttemptID else { return false }
        if attempt == nil, previous?[noteID] == nil { return true }
        if let current = previous?[noteID] {
            guard attempt?.id == current.id || (attempt == nil && current.terminal) else { return false }
        }
        var entries = previous ?? [:]
        entries[noteID] = attempt
        pendingAI[owner] = entries
        guard recoveryLedgerError == nil else { pendingAI[owner] = previous; return false }
        guard let ledgerURL else {
            guard allowsEphemeralLedger else { pendingAI[owner] = previous; return false }
            if attempt == nil { reconciledAI[noteID] = expectedAttemptID }
            return true
        }
        do {
            let data = try JSONEncoder().encode(pendingAI)
            try data.write(to: ledgerURL, options: .atomic)
            hasSeenLedgerFile = true
            if attempt == nil { reconciledAI[noteID] = expectedAttemptID }
            return true
        } catch {
            // A non-durable fence must never authorize an AI mutation.
            pendingAI[owner] = previous
            return false
        }
    }

    @discardableResult
    func recheckRecoveryLedger() -> Bool {
        loadLedger()
        return recoveryLedgerError == nil
    }

    func hasRetainedFence(noteID: String, attemptID: String) -> Bool {
        recoveryLedgerError == nil && (ledgerURL != nil || allowsEphemeralLedger) && pendingAttempt(noteID: noteID)?.id == attemptID
    }

    func wasReconciled(noteID: String, attemptID: String) -> Bool {
        reconciledAI[noteID] == attemptID
    }

    private func loadLedger() {
        guard let ledgerURL else {
            recoveryLedgerError = accountID != nil && !allowsEphemeralLedger ? Self.ledgerNotice : nil
            return
        }
        do {
            let data = try Data(contentsOf: ledgerURL)
            hasSeenLedgerFile = true
            pendingAI = try JSONDecoder().decode([String: [String: AIAttempt]].self, from: data)
            recoveryLedgerError = nil
        } catch {
            // A missing ledger is the first-run case. An existing unreadable or
            // corrupt one may contain a live attempt, so never silently unlock.
            let missing = (error as NSError).domain == NSCocoaErrorDomain && (error as NSError).code == NSFileReadNoSuchFileError
            if missing && !hasSeenLedgerFile { pendingAI = [:]; recoveryLedgerError = nil }
            else { hasSeenLedgerFile = true; recoveryLedgerError = Self.ledgerNotice }
        }
    }

    @ObservationIgnored private let cacheURL: URL?
    @ObservationIgnored private var hydrateTask: Task<Void, Never>?

    /// `cacheURL: nil` keeps the store entirely in memory, which is what the
    /// unit tests use.
    init(cacheURL: URL?, ledgerURL: URL? = nil, allowsEphemeralLedger: Bool = false) {
        self.cacheURL = cacheURL
        self.allowsEphemeralLedger = allowsEphemeralLedger
        self.ledgerURL = ledgerURL ?? cacheURL?.deletingLastPathComponent().appendingPathComponent("note-ai-pending.v1.json")
        loadLedger()
    }

    // MARK: - Persistence

    private struct Payload: Codable {
        var accountID: String?
        var notes: [Note]
        var folders: [Folder]
        var tags: [Tag]
    }

    static var defaultCacheURL: URL? {
        guard
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        else { return nil }
        let directory = base.appendingPathComponent("SureWord", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("notes-cache.v1.json")
    }

    /// Read the persisted cache exactly once per app run.
    func hydrate() async {
        if let hydrateTask {
            await hydrateTask.value
            return
        }
        let expected = epoch
        let task = Task { @MainActor in
            guard isCurrent(expected), !Task.isCancelled else { return }
            defer { if isCurrent(expected) { isHydrated = true } }
            guard let cacheURL, let data = try? Data(contentsOf: cacheURL) else { return }
            guard let payload = try? JSONDecoder().decode(Payload.self, from: data) else {
                // A corrupt cache must not block a network load.
                return
            }
            guard isCurrent(expected), !Task.isCancelled, payload.accountID == accountID else { return }
            notes = payload.notes
            folders = payload.folders
            tags = payload.tags
        }
        hydrateTask = task
        await task.value
    }

    private func persist() {
        guard let cacheURL else { return }
        let payload = Payload(accountID: accountID, notes: notes, folders: folders, tags: tags)
        guard let data = try? JSONEncoder().encode(payload) else { return }
        // A full or unwritable disk must never break the UI, so the failure is
        // swallowed rather than surfaced — the cache is an optimisation.
        try? data.write(to: cacheURL, options: .atomic)
    }

    // MARK: - Mutations

    /// Replace the cache with a server snapshot. List rows are summaries, so a
    /// cached body is carried over while the server row is unchanged
    /// (`updatedAt` bumps on every edit); a changed row drops the stale body so
    /// the editor refetches it.
    func applyServerSnapshot(notes serverNotes: [Note], folders: [Folder], tags: [Tag], epoch expected: UUID? = nil) {
        guard expected == nil || expected == epoch else { return }
        let previous = Dictionary(notes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        self.notes = serverNotes.map { note in
            guard
                let prior = previous[note.id],
                prior.hasBody,
                !note.hasBody,
                prior.updatedAt == note.updatedAt
            else { return note }
            var merged = note
            merged.content = prior.content
            merged.htmlContent = prior.htmlContent
            // Properties ride only on full rows, like the body: an unchanged
            // note keeps the copy a single-note fetch already brought in.
            merged.properties = prior.properties
            merged.hasBody = true
            return merged
        }
        self.folders = folders
        self.tags = tags
        isHydrated = true
        persist()
    }

    /// Refresh folders and tags without touching the cached notes.
    func applyFoldersAndTags(folders: [Folder], tags: [Tag], epoch expected: UUID? = nil) {
        guard expected == nil || expected == epoch else { return }
        self.folders = folders
        self.tags = tags
        persist()
    }

    func cachedNote(id: String) -> Note? {
        notes.first { $0.id == id }
    }

    func upsert(_ note: Note, epoch expected: UUID? = nil) {
        guard expected == nil || expected == epoch else { return }
        if let index = notes.firstIndex(where: { $0.id == note.id }) {
            notes[index] = note
        } else {
            notes.insert(note, at: 0)
        }
        persist()
    }

    func patch(id: String, epoch expected: UUID? = nil, _ change: (inout Note) -> Void) {
        guard expected == nil || expected == epoch else { return }
        guard let index = notes.firstIndex(where: { $0.id == id }) else { return }
        change(&notes[index])
        persist()
    }

    func removeNote(id: String, epoch expected: UUID? = nil) {
        guard expected == nil || expected == epoch else { return }
        notes.removeAll { $0.id == id }
        persist()
    }

    func addFolder(_ folder: Folder, epoch expected: UUID? = nil) {
        guard expected == nil || expected == epoch else { return }
        folders.append(folder)
        persist()
    }

    func renameFolder(_ folder: Folder, epoch expected: UUID? = nil) {
        guard expected == nil || expected == epoch else { return }
        if let index = folders.firstIndex(where: { $0.id == folder.id }) {
            folders[index] = folder
        }
        persist()
    }

    /// Deleting a folder unfiles its notes, matching what
    /// `DELETE /api/folders/{id}` does on the server.
    func removeFolder(id: String, epoch expected: UUID? = nil) {
        guard expected == nil || expected == epoch else { return }
        folders.removeAll { $0.id == id }
        for index in notes.indices where notes[index].folderId == id {
            notes[index].folderId = nil
        }
        persist()
    }

    func addTag(_ tag: Tag, epoch expected: UUID? = nil) {
        guard expected == nil || expected == epoch else { return }
        tags.append(tag)
        persist()
    }

    /// The join rows cascade on the server, so the local copies go too.
    func removeTag(id: String, epoch expected: UUID? = nil) {
        guard expected == nil || expected == epoch else { return }
        tags.removeAll { $0.id == id }
        for index in notes.indices where notes[index].tagIds.contains(id) {
            notes[index].tagIds.removeAll { $0 == id }
        }
        persist()
    }

    /// Test seam: drop everything without touching disk semantics.
    func reset() {
        invalidateSession()
        notes = []
        folders = []
        tags = []
    }

    /// Drop everything **including the file on disk**. This store is a
    /// singleton that outlives a session, so a user switch has to clear it in
    /// memory as well: notes belong to an account, and the next account must
    /// never see the last one's cache.
    func clearCache() {
        reset()
        guard let cacheURL else { return }
        try? FileManager.default.removeItem(at: cacheURL)
    }
}
