import Foundation
import Testing
@testable import SureWord

@MainActor
@Suite("Saved answer owner review")
struct SavedAnswerReviewTests {
    private let ownerA = SavedAnswerReviewOwner(accountID: "account-a", sessionID: "session-a")
    private let digest = String(repeating: "a", count: 64)

    private func marker(surface: String = "chat", parent: String = "conversation-1", message: String = "answer-1",
                        digest: String? = nil, state: String = "withheld") -> JSONValue {
        .object(["surface": .string(surface), "parentId": .string(parent), "messageId": .string(message),
                 "state": .string(state), "code": .string("review_required"), "sourceDigest": .string(digest ?? self.digest)])
    }

    private func binding(surface: String = "chat", parent: String = "conversation-1", digest: String? = nil) throws -> SavedAnswerReviewBinding {
        let metadata = try #require(SavedAnswerReviewMetadata(marker(surface: surface, parent: parent, digest: digest), messageID: "answer-1"))
        return SavedAnswerReviewBinding(owner: ownerA, metadata: metadata)
    }

    private func safeRow() -> JSONValue {
        .object([
            "id": .string("answer-1"), "role": .string("assistant"), "content": .string("Checked answer"), "feedback": .string("up"),
            "metadata": .object([
                "followUps": .array([.string("Read more?")]),
                "parts": .array([
                    .object(["type": .string("text"), "text": .string("Checked answer")]),
                    .object(["type": .string("tool-searchScripture"), "toolCallId": .string("verse-1"), "state": .string("output-available"),
                             "output": .object(["verses": .array([.object(["reference": .string("John 3:16"), "text": .string("For God so loved the world"), "similarity": .number(0.9)])])])]),
                    .object(["type": .string("tool-addToNote"), "toolCallId": .string("note-1"), "state": .string("output-available"),
                             "output": .object(["noteId": .string("saved-note"), "noteTitle": .string("Study"), "created": .bool(true)])]),
                    .object(["type": .string("data-progress"), "id": .string("progress"), "data": .object([
                        "version": .number(1), "runId": .string("run-1"), "sequence": .number(1), "elapsedMs": .number(9000),
                        "lastActivityMs": .number(8000), "state": .string("complete"), "phase": .string("answering"),
                        "label": .string("Work completed"), "entries": .array([])])])
                ])
            ])
        ])
    }

    private func response(state: String = "verified", digest: String? = nil, row: JSONValue? = nil) throws -> Data {
        try JSONEncoder().encode(JSONValue.object(["state": .string(state), "sourceDigest": .string(digest ?? self.digest), "row": row ?? safeRow()]))
    }

    private func original(parent: String = "conversation-1", message: String = "answer-1") throws -> Data {
        try JSONEncoder().encode(JSONValue.object([
            "formatVersion": .number(1), "surface": .string("chat"), "parentId": .string(parent), "messageId": .string(message),
            "current": .object(["id": .string(message), "content": .string("Unchecked archived text"), "metadata": .object(["oldTool": .string("Never execute")])]),
            "versions": .array([])
        ]))
    }

    private func transport(state: Data) -> SavedAnswerReviewTransport {
        SavedAnswerReviewTransport(recheck: { _ in }, state: { _ in state }, original: { _ in Data() })
    }

    @Test("Only complete server locators and lowercase source digests enable review")
    func metadataValidation() throws {
        for surface in ["chat", "note"] {
            let metadata = try #require(SavedAnswerReviewMetadata(marker(surface: surface), messageID: "answer-1"))
            #expect(metadata.locator.surface.rawValue == surface)
            #expect(metadata.locator.query == "surface=\(surface)&parentId=conversation-1&messageId=answer-1")
        }
        for value in [marker(surface: "other"), marker(parent: "bad&messageId=other"), marker(message: "other"),
                      marker(digest: String(repeating: "A", count: 64)), marker(digest: "short"), marker(state: "verified"), .null] {
            #expect(SavedAnswerReviewRequirement(value, messageID: "answer-1") == .invalid)
        }
        #expect(SavedAnswerReviewRequirement(nil, messageID: "answer-1") == nil)
        #expect(SavedAnswerReviewRequirement(.object(["state": .string("pending")]), messageID: "answer-1") == .invalid)
    }

    @Test("Restored assistant markers stay visible and malformed markers cannot fall through")
    func messageReduction() throws {
        for value in [marker(), .null] {
            let stored = try #require(UIMessage(storedRow: .object([
                "id": .string("answer-1"), "role": .string("assistant"), "content": .string(""),
                "metadata": .object(["parts": .array([]), "historyVerification": value])
            ])))
            let message = ChatViewMessage(message: stored, isStreaming: false)
            #expect(message.savedAnswerReview != nil)
            #expect(message.hasRenderableContent)
            #expect(ChatViewMessage(message: stored, isStreaming: true).savedAnswerReview != nil)
        }
        let ordinary = ChatViewMessage(message: UIMessage(id: "user", role: .user, parts: [.text(id: "t", text: "Question")],
                                                         metadata: .object(["historyVerification": marker()])), isStreaming: false)
        #expect(ordinary.savedAnswerReview == nil)
        #expect(ordinary.content == "Question")
    }

    @Test("Explicit recheck encodes only the exact four content-free contract fields")
    func requestContract() throws {
        let current = try binding(surface: "note", parent: "note_1")
        let request = SavedAnswerRecheckRequest(current.metadata)
        let json = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(request))
        #expect(Set(json.objectValue?.keys.map { $0 } ?? []) == Set(["surface", "parentId", "messageId", "expectedSourceDigest"]))
        #expect(json["surface"] == .string("note"))
        #expect(json["parentId"] == .string("note_1"))
        #expect(json["messageId"] == .string("answer-1"))
        #expect(json["expectedSourceDigest"] == .string(digest))
    }

    @Test("Checked rows preserve the existing cards, receipts, feedback, follow-ups, and progress")
    func checkedReduction() throws {
        let current = try binding()
        let parsed = try SavedAnswerReviewResponse(data: response(), matching: current.metadata)
        let message = try #require(parsed.message)
        let original = try #require(UIMessage(storedRow: safeRow()))
        #expect(message == ChatViewMessage(message: original, isStreaming: false))
        #expect(message.retrievedVerses.first?.reference == "John 3:16")
        #expect(message.noteActions.count == 1)
        #expect(message.receipts.first?.target == .note(noteID: "saved-note"))
        #expect(message.feedback == .up)
        #expect(message.followUps == ["Read more?"])
        #expect(message.progress?.elapsedMs == 9000)
        #expect(message.savedAnswerReview == nil)
        #expect(try SavedAnswerReviewResponse(data: response(state: "notice"), matching: current.metadata).message != nil)
    }

    @Test("Checked rendering follows live feedback without borrowing unchecked parent fields")
    func checkedRenderingPreservesLiveFeedback() async throws {
        let current = try binding()
        let model = SavedAnswerReviewModel(owner: { ownerA })
        let safe = try response()
        var calls: [String] = []
        model.activate(current)
        await model.check(current, using: SavedAnswerReviewTransport(recheck: { _ in calls.append("post") },
            state: { _ in calls.append("get"); return safe }, original: { _ in Data() }))
        let checked = try #require(model.message(for: current))
        #expect(checked.feedback == .up)
        var parent = ChatViewMessage(id: "answer-1", role: .assistant, content: "Unchecked archived text",
            followUps: ["Unchecked follow-up"], feedback: .up,
            savedAnswerReview: .review(current.metadata))
        let updates: [AnswerFeedback?] = [.down, nil, .up, .down, .up]
        // Optimistic down, toggle off, up, another down, then a failed-write
        // rollback to up. None changes the owner/locator/digest review binding.
        for feedback in updates {
            parent.feedback = feedback
            let stillChecked = try #require(model.message(for: current))
            let rendered = stillChecked.preservingLiveFeedback(from: parent)
            var expected = checked
            expected.feedback = feedback
            #expect(rendered == expected)
            #expect(rendered.content == "Checked answer")
            #expect(rendered.retrievedVerses == checked.retrievedVerses)
            #expect(rendered.receipts == checked.receipts)
            #expect(rendered.progress == checked.progress)
            #expect(rendered.followUps == ["Read more?"])
            #expect(rendered.savedAnswerReview == nil)
            #expect(model.message(for: current) == checked)
        }
        #expect(calls == ["post", "get"])
    }

    @Test("Wrong digest, row identity, role, state, or contradictory marker cannot become a checked bubble")
    func rejectsInvalidState() throws {
        let current = try binding()
        for data in [try response(digest: String(repeating: "b", count: 64)), try response(state: "unknown"),
                     try response(row: .object(["id": .string("other"), "role": .string("assistant"), "content": .string("Unsafe")])),
                     try response(row: .object(["id": .string("answer-1"), "role": .string("user"), "content": .string("Unsafe")])),
                     try response(row: .object(["id": .string("answer-1"), "role": .string("assistant"), "content": .string("Unsafe"),
                                               "metadata": .object(["parts": .array([]), "historyVerification": marker()])]))] {
            #expect(throws: SavedAnswerReviewError.self) { try SavedAnswerReviewResponse(data: data, matching: current.metadata) }
        }
        for state in ["pending", "withheld"] {
            // Even a malformed server notice containing an old card never gets
            // passed to the checked-message renderer in these states.
            #expect(try SavedAnswerReviewResponse(data: response(state: state), matching: current.metadata).message == nil)
        }
    }

    @Test("Activation is read-only; explicit check awaits POST then fetches the authoritative safe row")
    func explicitOnly() async throws {
        let current = try binding()
        let owner = ReviewOwnerBox(ownerA)
        let model = SavedAnswerReviewModel(owner: { owner.value })
        let safe = try response()
        var calls: [String] = []
        let transport = SavedAnswerReviewTransport(recheck: { request in
            #expect(request == SavedAnswerRecheckRequest(current.metadata)); calls.append("post")
        }, state: { locator in
            #expect(locator == current.metadata.locator); calls.append("get"); return safe
        }, original: { _ in calls.append("original"); return Data() })
        model.activate(current)
        #expect(calls.isEmpty)
        #expect(model.message(for: current) == nil)
        await model.check(current, using: transport)
        #expect(calls == ["post", "get"])
        #expect(model.state == .verified)
        #expect(model.message(for: current)?.content == "Checked answer")
    }

    @Test("A session or account change during POST prevents the subsequent GET", arguments: [
        SavedAnswerReviewOwner(accountID: "account-a", sessionID: "session-b"),
        SavedAnswerReviewOwner(accountID: "account-b", sessionID: "session-b")
    ])
    func heldPostOwnerChange(next: SavedAnswerReviewOwner) async throws {
        let current = try binding()
        let owner = ReviewOwnerBox(ownerA)
        let model = SavedAnswerReviewModel(owner: { owner.value })
        let gate = ReviewSuspension()
        let safe = try response()
        var reads = 0
        model.activate(current)
        let task = Task { await model.check(current, using: SavedAnswerReviewTransport(recheck: { _ in _ = await gate.suspend() },
                        state: { _ in reads += 1; return safe }, original: { _ in Data() })) }
        await gate.waitForArrival()
        owner.value = next
        gate.resume(Data())
        await task.value
        #expect(reads == 0)
        #expect(model.message(for: current) == nil)
        #expect(model.state == nil)
    }

    @Test("A held safe GET cannot be adopted under a changed owner, session, locator, digest, or disappeared view",
           arguments: ["owner", "session", "locator", "digest", "disappear"])
    func heldStateInvalidation(change: String) async throws {
        let current = try binding()
        let owner = ReviewOwnerBox(ownerA)
        let model = SavedAnswerReviewModel(owner: { owner.value })
        let gate = ReviewSuspension()
        let safe = try response()
        model.activate(current)
        let task = Task { await model.check(current, using: SavedAnswerReviewTransport(recheck: { _ in },
                        state: { _ in await gate.suspend() }, original: { _ in Data() })) }
        await gate.waitForArrival()
        switch change {
        case "owner": owner.value = SavedAnswerReviewOwner(accountID: "other", sessionID: "session-a")
        case "session": owner.value = SavedAnswerReviewOwner(accountID: "account-a", sessionID: "other")
        case "locator": model.activate(try binding(parent: "other-parent"))
        case "digest": model.activate(try binding(digest: String(repeating: "b", count: 64)))
        default: model.activate(nil)
        }
        gate.resume(safe)
        await task.value
        #expect(model.message(for: current) == nil)
        #expect(model.state == nil)
        #expect(model.error == nil)
    }

    @Test("Cancellation during a held POST or GET prevents adoption even if transport returns success", arguments: ["post", "get"])
    func cancelledCheck(stage: String) async throws {
        let current = try binding()
        let model = SavedAnswerReviewModel(owner: { ownerA })
        let gate = ReviewSuspension()
        let safe = try response()
        var reads = 0
        model.activate(current)
        let task = Task { await model.check(current, using: SavedAnswerReviewTransport(recheck: { _ in
            if stage == "post" { _ = await gate.suspend() }
        }, state: { _ in reads += 1; return stage == "get" ? await gate.suspend() : safe }, original: { _ in Data() })) }
        await gate.waitForArrival()
        task.cancel()
        gate.resume(safe)
        await task.value
        #expect(reads == (stage == "post" ? 0 : 1))
        #expect(model.message(for: current) == nil)
        #expect(model.state == nil)
        #expect(!model.isChecking)
    }

    @Test("A task cancelled before checking sends no request")
    func preCancelledCheck() async throws {
        let current = try binding()
        let model = SavedAnswerReviewModel(owner: { ownerA })
        var requests = 0
        model.activate(current)
        let task = Task { await model.check(current, using: SavedAnswerReviewTransport(recheck: { _ in requests += 1 },
                        state: { _ in requests += 1; return Data() }, original: { _ in requests += 1; return Data() })) }
        task.cancel()
        await task.value
        #expect(requests == 0)
    }

    @Test("Unchecked original data is export-only and is revoked immediately when ownership changes")
    func originalExport() async throws {
        let current = try binding()
        let owner = ReviewOwnerBox(ownerA)
        let model = SavedAnswerReviewModel(owner: { owner.value })
        let data = try original()
        var checks = 0
        model.activate(current)
        await model.prepareDownload(current, using: SavedAnswerReviewTransport(recheck: { _ in checks += 1 },
                                   state: { _ in checks += 1; return Data() }, original: { _ in data }))
        #expect(model.download(for: current) == data)
        #expect(model.message(for: current) == nil)
        #expect(checks == 0)
        owner.value = SavedAnswerReviewOwner(accountID: "account-a", sessionID: "new-session")
        #expect(model.download(for: current) == nil)
        model.activate(nil)
        owner.value = ownerA
        #expect(model.download(for: current) == nil)
    }

    @Test("Held original replies are discarded after cancellation, identity change, or disappearance",
           arguments: ["cancel", "session", "disappear"])
    func heldOriginalInvalidation(change: String) async throws {
        let current = try binding()
        let owner = ReviewOwnerBox(ownerA)
        let model = SavedAnswerReviewModel(owner: { owner.value })
        let gate = ReviewSuspension()
        let data = try original()
        model.activate(current)
        let task = Task { await model.prepareDownload(current, using: SavedAnswerReviewTransport(recheck: { _ in },
                        state: { _ in Data() }, original: { _ in await gate.suspend() })) }
        await gate.waitForArrival()
        if change == "cancel" { task.cancel() }
        else if change == "session" { owner.value = SavedAnswerReviewOwner(accountID: "account-a", sessionID: "other") }
        else { model.activate(nil) }
        gate.resume(data)
        await task.value
        #expect(model.download(for: current) == nil)
        #expect(model.message(for: current) == nil)
    }

    @Test("Wrong-locator, invalid JSON, and oversized originals never reach export")
    func invalidOriginals() async throws {
        let current = try binding()
        let model = SavedAnswerReviewModel(owner: { ownerA })
        for data in [try original(parent: "other"), Data("not JSON".utf8), Data(repeating: 32, count: 2_000_001)] {
            model.activate(current)
            await model.prepareDownload(current, using: SavedAnswerReviewTransport(recheck: { _ in }, state: { _ in Data() }, original: { _ in data }))
            #expect(model.download(for: current) == nil)
            #expect(model.error != nil)
        }
    }

    @Test("Recheck authorization requires an existing owner before opening consent")
    func consentRequiresOwner() async {
        var prompts = 0
        do {
            try await SavedAnswerReviewTransport.authorizeRecheck(owner: { nil }, consent: { prompts += 1; return true })
            Issue.record("A signed-out recheck was authorized")
        } catch let error as APIError {
            #expect(error.status == 401)
        } catch { Issue.record("Unexpected authorization error") }
        #expect(prompts == 0)
    }

    @Test("Only granted consent authorizes the captured owner's recheck", arguments: [true, false])
    func consentDecision(granted: Bool) async {
        var prompts = 0
        var authorized = false
        do {
            try await SavedAnswerReviewTransport.authorizeRecheck(owner: { ownerA }, consent: { prompts += 1; return granted })
            authorized = true
        } catch let error as APIError {
            #expect(error.status == 403)
        } catch { Issue.record("Unexpected authorization error") }
        #expect(prompts == 1)
        #expect(authorized == granted)
    }

    @Test("Held granted consent cannot authorize another account/session or a cancelled caller",
           arguments: ["owner", "session", "cancel"])
    func heldConsentInvalidation(change: String) async {
        let owner = ReviewOwnerBox(ownerA)
        let gate = ReviewSuspension()
        var authorized = false
        let task = Task {
            do {
                try await SavedAnswerReviewTransport.authorizeRecheck(owner: { owner.value }, consent: { _ = await gate.suspend(); return true })
                authorized = true
            } catch { /* Expected: no POST continuation is authorized. */ }
        }
        await gate.waitForArrival()
        if change == "owner" { owner.value = SavedAnswerReviewOwner(accountID: "other", sessionID: "session-a") }
        else if change == "session" { owner.value = SavedAnswerReviewOwner(accountID: "account-a", sessionID: "other") }
        else { task.cancel() }
        gate.resume(Data())
        await task.value
        #expect(!authorized)
    }

    @Test("A pre-cancelled recheck cannot open the consent sheet")
    func preCancelledConsent() async {
        var prompts = 0
        var authorized = false
        let task = Task {
            do {
                try await SavedAnswerReviewTransport.authorizeRecheck(owner: { ownerA }, consent: { prompts += 1; return true })
                authorized = true
            } catch { /* The cancelled caller has no permission to infer. */ }
        }
        task.cancel()
        await task.value
        #expect(prompts == 0)
        #expect(!authorized)
    }
}

@MainActor private final class ReviewOwnerBox {
    var value: SavedAnswerReviewOwner?
    init(_ value: SavedAnswerReviewOwner) { self.value = value }
}

/// Deliberately ignores cancellation, reproducing a late HTTP completion.
@MainActor private final class ReviewSuspension {
    private var continuation: CheckedContinuation<Data, Never>?
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var arrived = false

    func suspend() async -> Data {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            arrived = true
            waiters.forEach { $0.resume() }
            waiters = []
        }
    }
    func waitForArrival() async {
        if arrived { return }
        await withCheckedContinuation { waiters.append($0) }
    }
    func resume(_ data: Data) { continuation?.resume(returning: data); continuation = nil }
}
