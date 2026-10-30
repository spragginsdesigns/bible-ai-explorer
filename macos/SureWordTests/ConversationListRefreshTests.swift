import Foundation
import XCTest
@testable import SureWord

/// Held transport responses exercise ordering through the real model/APIClient
/// boundary. Every URL uses an isolated .invalid host with a nil token provider.
@MainActor
final class ConversationListRefreshTests: XCTestCase {
    private static let listPath = "/api/conversations"
    private static let first = Conversation(id: "c1", title: "Who is Melchizedek?", createdAt: "2026-10-29")
    private static let second = Conversation(id: "c2", title: "Psalm 23", createdAt: "2026-10-28")
    private static let finishedAnswer =
        "data: {\"type\":\"start\",\"messageId\":\"a1\"}\n\n"
        + "data: {\"type\":\"text-delta\",\"id\":\"0\",\"delta\":\"He is the king of Salem.\"}\n\n"
        + "data: {\"type\":\"finish\"}\n\n"

    private func makeChat(_ rows: [Conversation]? = nil) async throws -> Fixture {
        let server = ConversationListRefreshServer()
        ConversationListRefreshURLProtocol.register(server)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ConversationListRefreshURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let api = APIClient(
            baseURL: URL(string: "https://\(server.host)")!,
            token: { _ in nil },
            onAuthFailure: {},
            session: session
        )
        let chat = ChatViewModel(api: api, settings: SettingsStore(), stopSignals: ChatStopSignals())
        let fixture = Fixture(chat: chat, server: server, session: session)
        // Register before the first setup suspension, including failed setup.
        addTeardownBlock { await fixture.close() }
        let load = fixture.task { await chat.loadConversations() }
        let initial = try await request(server, "GET", Self.listPath)
        initial.respond(rows: rows ?? [Self.first, Self.second])
        await load.value
        return fixture
    }

    @MainActor
    private final class Fixture {
        private struct CallerTask: Sendable {
            let cancel: @Sendable () -> Void
            let wait: @Sendable () async -> Void
        }

        let chat: ChatViewModel
        let server: ConversationListRefreshServer
        let session: URLSession
        private var callers: [CallerTask] = []
        private var cleanup: Task<Void, Never>?
        private(set) var isClosed = false

        init(chat: ChatViewModel, server: ConversationListRefreshServer, session: URLSession) {
            self.chat = chat
            self.server = server
            self.session = session
        }

        func task<Value: Sendable>(_ operation: @escaping @MainActor @Sendable () async -> Value) -> Task<Value, Never> {
            let task = Task { await operation() }
            callers.append(CallerTask(cancel: { task.cancel() }, wait: { _ = await task.value }))
            return task
        }

        func close() async {
            if let cleanup { await cleanup.value; return }
            let callers = callers
            callers.forEach { $0.cancel() }
            let chat = chat
            let session = session
            let server = server
            let cleanup = Task {
                // Caller-owned mutations/loads can schedule model-owned work as
                // they unwind. Finish those callers before draining the model.
                for caller in callers { await caller.wait() }
                await chat.teardown().value
                session.invalidateAndCancel()
                ConversationListRefreshURLProtocol.unregister(server)
                isClosed = true
            }
            self.cleanup = cleanup
            await cleanup.value
        }
    }

    private func request(
        _ server: ConversationListRefreshServer,
        _ method: String,
        _ path: String,
        ordinal: Int = 0,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async throws -> ConversationListRefreshServer.HeldRequest {
        let expected = server.expectRequest(method, path, ordinal: ordinal)
        let result = await XCTWaiter.fulfillment(of: [expected], timeout: 2)
        XCTAssertEqual(result, .completed, "Missing \(method) \(path) #\(ordinal)", file: file, line: line)
        return try XCTUnwrap(server.request(method, path, ordinal: ordinal), file: file, line: line)
    }

    private func expectNoAdditionalListRequest(_ server: ConversationListRefreshServer) async {
        let expected = server.expectRequest("GET", Self.listPath, ordinal: server.listRequestCount)
        expected.isInverted = true
        let result = await XCTWaiter.fulfillment(of: [expected], timeout: 0.1)
        XCTAssertEqual(result, .completed)
    }

    private func respondAndWaitForRows(
        _ held: ConversationListRefreshServer.HeldRequest,
        rows: [Conversation],
        chat: ChatViewModel,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        held.respond(rows: rows)
        // Equal snapshots need no Observation change event. The held request
        // proves the GET ran; wait for the actual row contract when it differs.
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(2))
        while chat.conversations != rows, clock.now < deadline {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(chat.conversations, rows, "Conversation snapshot did not converge", file: file, line: line)
    }

    func testFinishedAnswerNotifiesImmediatelyThenRefreshesWithoutChangingTheOpenThread() async throws {
        let fixture = try await makeChat()
        let chat = fixture.chat
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?")
        var notifications: [(String, String?, Bool)] = []
        chat.onAnswerReady = { id, title, recovered in
            XCTAssertEqual(fixture.server.listRequestCount, 1)
            notifications.append((id, title, recovered))
        }

        await chat.consume(ConversationListRefreshBytes(Self.finishedAnswer))

        XCTAssertEqual(notifications.count, 1)
        XCTAssertEqual(notifications.first?.0, "c1")
        XCTAssertEqual(notifications.first?.1, Self.first.title)
        XCTAssertEqual(notifications.first?.2, false)
        XCTAssertEqual(chat.status, .idle)
        let messageIDs = chat.messages.map(\.id)
        let refreshed = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        // A held list GET cannot hold up the answer or its notification.
        XCTAssertEqual(chat.messages.last?.content, "He is the king of Salem.")
        XCTAssertEqual(chat.activeConversation?.title, Self.first.title)
        let canonical = Conversation(id: "c1", title: "Melchizedek, King of Salem", createdAt: Self.first.createdAt)
        await respondAndWaitForRows(refreshed, rows: [canonical, Self.second], chat: chat)

        XCTAssertEqual(chat.activeConversation?.title, canonical.title)
        XCTAssertEqual(chat.activeConversationID, "c1")
        XCTAssertEqual(chat.messages.map(\.id), messageIDs)
    }

    func testRecoveredAnswerRefreshesTheListAfterRestoringTheSavedMessages() async throws {
        let fixture = try await makeChat()
        let chat = fixture.chat
        fixture.server.detailPayload = #"{"messages":[{"id":"user-seed","role":"user","content":"Who?"},{"id":"saved-answer","role":"assistant","content":"A saved answer."}]}"#
        chat.seedPendingSend(conversationID: "c1", question: "Who?")
        var recoveredNotifications = 0
        chat.onAnswerReady = { id, _, recovered in
            XCTAssertEqual(id, "c1")
            XCTAssertTrue(recovered)
            XCTAssertEqual(chat.messages.last?.content, "A saved answer.")
            recoveredNotifications += 1
        }

        await chat.consume(ConversationListRefreshBytes(""))
        let refresh = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        XCTAssertEqual(recoveredNotifications, 1)
        XCTAssertFalse(chat.isRecovering)
        XCTAssertNil(chat.sendError)
        let messageIDs = chat.messages.map(\.id)
        let canonical = Conversation(id: "c1", title: "A canonical recovered title", createdAt: Self.first.createdAt)
        await respondAndWaitForRows(refresh, rows: [canonical], chat: chat)

        XCTAssertEqual(chat.activeConversation?.title, canonical.title)
        XCTAssertEqual(chat.messages.map(\.id), messageIDs)
    }

    func testHistoryOpenAndForegroundCanCollectATitleGeneratedAfterTheSettleRefresh() async throws {
        let fixture = try await makeChat()
        let chat = fixture.chat
        chat.seedPendingSend(conversationID: "c1", question: "Who?")
        await chat.consume(ConversationListRefreshBytes(Self.finishedAnswer))
        let settled = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        // The server's title job need not have finished when the answer did.
        await respondAndWaitForRows(settled, rows: [Self.first, Self.second], chat: chat)
        XCTAssertEqual(chat.activeConversation?.title, Self.first.title)
        let messageIDs = chat.messages.map(\.id)

        chat.isHistoryPresented = true
        let opened = try await request(fixture.server, "GET", Self.listPath, ordinal: 2)
        let canonical = Conversation(id: "c1", title: "Melchizedek in Hebrews", createdAt: Self.first.createdAt)
        await respondAndWaitForRows(opened, rows: [canonical, Self.second], chat: chat)
        XCTAssertEqual(chat.activeConversation?.title, canonical.title)
        chat.isHistoryPresented = true
        await expectNoAdditionalListRequest(fixture.server)

        chat.refreshConversationsIfIdle()
        let foreground = try await request(fixture.server, "GET", Self.listPath, ordinal: 3)
        let renamedElsewhere = Conversation(id: "c1", title: "A later server title", createdAt: Self.first.createdAt)
        await respondAndWaitForRows(foreground, rows: [renamedElsewhere], chat: chat)
        XCTAssertEqual(chat.activeConversation?.title, renamedElsewhere.title)
        XCTAssertEqual(chat.activeConversationID, "c1")
        XCTAssertEqual(chat.messages.map(\.id), messageIDs)
    }

    func testForegroundAndHistoryOpeningLeaveAHealthyAnswerAlone() async throws {
        let fixture = try await makeChat()
        fixture.chat.seedPendingSend(conversationID: "c1", question: "Who?", status: .streaming)

        fixture.chat.refreshConversationsIfIdle()
        fixture.chat.isHistoryPresented = true

        await expectNoAdditionalListRequest(fixture.server)
        XCTAssertEqual(fixture.chat.status, .streaming)
        XCTAssertFalse(fixture.chat.isRecovering)
        XCTAssertNil(fixture.chat.sendError)
    }

    func testOverlappingListLoadsKeepTheNewestResponseWhenTheyFinishInReverseOrder() async throws {
        let fixture = try await makeChat()
        let earlier = fixture.task { await fixture.chat.loadConversations() }
        let earlierRequest = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        let later = fixture.task { await fixture.chat.loadConversations() }
        let laterRequest = try await request(fixture.server, "GET", Self.listPath, ordinal: 2)
        let canonical = Conversation(id: "c1", title: "Newest server title", createdAt: Self.first.createdAt)

        laterRequest.respond(rows: [canonical])
        await later.value
        earlierRequest.respond(rows: [Self.first, Self.second])
        await earlier.value

        XCTAssertEqual(fixture.chat.conversations, [canonical])
    }

    func testHeldListResponseCannotUndoAnAcceptedRename() async throws {
        let fixture = try await makeChat()
        let staleLoad = fixture.task { await fixture.chat.loadConversations() }
        let stale = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        let rename = fixture.task { await fixture.chat.renameConversation("c1", to: "My accepted name") }
        let patch = try await request(fixture.server, "PATCH", "/api/conversations/c1")
        patch.respond()
        let error = await rename.value
        XCTAssertNil(error)

        stale.respond(rows: [Self.first, Self.second])
        await staleLoad.value

        XCTAssertEqual(fixture.chat.conversations.first?.title, "My accepted name")
    }

    func testHeldListResponseCannotResurrectAnAcceptedDeletion() async throws {
        let fixture = try await makeChat()
        await fixture.chat.switchConversation(to: "c2")
        let staleLoad = fixture.task { await fixture.chat.loadConversations() }
        let stale = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        let deletion = fixture.task { await fixture.chat.deleteConversation("c1") }
        let remove = try await request(fixture.server, "DELETE", "/api/conversations/c1")
        remove.respond()
        await deletion.value

        stale.respond(rows: [Self.first, Self.second])
        await staleLoad.value

        XCTAssertEqual(fixture.chat.conversations, [Self.second])
        XCTAssertEqual(fixture.chat.activeConversationID, "c2")
    }

    func testHeldListResponseCannotRestoreAClearedList() async throws {
        let fixture = try await makeChat()
        let staleLoad = fixture.task { await fixture.chat.loadConversations() }
        let stale = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        let clear = fixture.task { await fixture.chat.clearAllConversations() }
        let firstDelete = try await request(fixture.server, "DELETE", "/api/conversations/c1")
        firstDelete.respond()
        let secondDelete = try await request(fixture.server, "DELETE", "/api/conversations/c2")
        secondDelete.respond()
        await clear.value

        stale.respond(rows: [Self.first, Self.second])
        await staleLoad.value

        XCTAssertTrue(fixture.chat.conversations.isEmpty)
        XCTAssertNil(fixture.chat.activeConversationID)
        XCTAssertTrue(fixture.chat.messages.isEmpty)
    }

    func testHeldListResponseCannotDropANewlyCreatedConversation() async throws {
        let fixture = try await makeChat([Self.first])
        let staleLoad = fixture.task { await fixture.chat.loadConversations() }
        let stale = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        fixture.chat.input = "A new question"
        let send = fixture.task { await fixture.chat.send() }
        let creation = try await request(fixture.server, "POST", Self.listPath)
        let created = Conversation(id: "created", title: "A new question", createdAt: "2026-10-29")
        creation.respond(body: String(decoding: try JSONEncoder().encode(created), as: UTF8.self))
        await send.value
        _ = try await request(fixture.server, "POST", "/api/ask-question")

        stale.respond(rows: [Self.first])
        await staleLoad.value

        XCTAssertEqual(fixture.chat.conversations, [created, Self.first])
        XCTAssertEqual(fixture.chat.activeConversationID, created.id)
        XCTAssertEqual(fixture.chat.messages.first?.content, "A new question")
    }

    func testRefreshRequestedDuringConcurrentMutationsWaitsForTheLastMutation() async throws {
        let fixture = try await makeChat()
        let rename = fixture.task { await fixture.chat.renameConversation("c1", to: "My accepted name") }
        let patch = try await request(fixture.server, "PATCH", "/api/conversations/c1")
        let deletion = fixture.task { await fixture.chat.deleteConversation("c2") }
        let remove = try await request(fixture.server, "DELETE", "/api/conversations/c2")

        fixture.chat.refreshConversationsIfIdle()
        await fixture.chat.loadConversations()
        await expectNoAdditionalListRequest(fixture.server)
        patch.respond()
        _ = await rename.value
        await expectNoAdditionalListRequest(fixture.server)
        remove.respond()
        await deletion.value

        let queued = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        let accepted = Conversation(id: "c1", title: "My accepted name", createdAt: Self.first.createdAt)
        await respondAndWaitForRows(queued, rows: [accepted], chat: fixture.chat)
        XCTAssertEqual(fixture.chat.conversations, [accepted])
        XCTAssertEqual(fixture.server.listRequestCount, 2)
    }

    func testFailedDeleteRestorationUsesTheSameOrderingAsOtherListLoads() async throws {
        let fixture = try await makeChat()
        let staleLoad = fixture.task { await fixture.chat.loadConversations() }
        let stale = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        let deletion = fixture.task { await fixture.chat.deleteConversation("c1") }
        let remove = try await request(fixture.server, "DELETE", "/api/conversations/c1")
        remove.respond(status: 503, body: #"{"error":"Refused"}"#)
        let restore = try await request(fixture.server, "GET", Self.listPath, ordinal: 2)
        restore.respond(rows: [Self.first, Self.second])
        await deletion.value

        stale.respond(rows: [])
        await staleLoad.value

        XCTAssertEqual(fixture.chat.conversations, [Self.first, Self.second])
        XCTAssertEqual(fixture.chat.historyAlert?.title, "Couldn't delete chat")
    }

    func testFailedDeleteRestorationIsQueuedUntilAConcurrentRenameSettles() async throws {
        let fixture = try await makeChat()
        let deletion = fixture.task { await fixture.chat.deleteConversation("c1") }
        let remove = try await request(fixture.server, "DELETE", "/api/conversations/c1")
        let rename = fixture.task { await fixture.chat.renameConversation("c2", to: "My Psalm study") }
        let patch = try await request(fixture.server, "PATCH", "/api/conversations/c2")

        remove.respond(status: 503, body: #"{"error":"Refused"}"#)
        await deletion.value
        XCTAssertEqual(fixture.chat.historyAlert?.title, "Couldn't delete chat")
        await expectNoAdditionalListRequest(fixture.server)
        patch.respond()
        _ = await rename.value

        let restore = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        let renamed = Conversation(id: "c2", title: "My Psalm study", createdAt: Self.second.createdAt)
        await respondAndWaitForRows(restore, rows: [Self.first, renamed], chat: fixture.chat)
        XCTAssertEqual(fixture.chat.conversations, [Self.first, renamed])
    }

    func testFailedDeleteRestorationInvalidatedByALaterRenameGetsOneReplacementLoad() async throws {
        let fixture = try await makeChat()
        let deletion = fixture.task { await fixture.chat.deleteConversation("c1") }
        let remove = try await request(fixture.server, "DELETE", "/api/conversations/c1")
        remove.respond(status: 503, body: #"{"error":"Refused"}"#)
        let staleRestore = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)

        // Unlike the concurrent-mutation case above, this write starts after
        // restoration is already in flight and invalidates that GET.
        let rename = fixture.task { await fixture.chat.renameConversation("c2", to: "My Psalm study") }
        let patch = try await request(fixture.server, "PATCH", "/api/conversations/c2")
        patch.respond()
        let renameError = await rename.value
        XCTAssertNil(renameError)
        let renamed = Conversation(id: "c2", title: "My Psalm study", createdAt: Self.second.createdAt)

        staleRestore.respond(rows: [Self.first, Self.second])
        await deletion.value
        XCTAssertEqual(fixture.chat.conversations, [renamed])
        XCTAssertEqual(fixture.chat.historyAlert?.title, "Couldn't delete chat")

        let replacement = try await request(fixture.server, "GET", Self.listPath, ordinal: 2)
        await respondAndWaitForRows(replacement, rows: [Self.first, renamed], chat: fixture.chat)
        XCTAssertEqual(fixture.chat.conversations, [Self.first, renamed])
        XCTAssertEqual(fixture.server.listRequestCount, 3)
        await expectNoAdditionalListRequest(fixture.server)
    }

    func testCancellingADeleteStillReconcilesItsOptimisticRemoval() async throws {
        let fixture = try await makeChat()
        let deletion = fixture.task { await fixture.chat.deleteConversation("c1") }
        _ = try await request(fixture.server, "DELETE", "/api/conversations/c1")
        XCTAssertFalse(fixture.chat.conversations.contains { $0.id == "c1" })

        deletion.cancel()
        await deletion.value

        let restore = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        await respondAndWaitForRows(restore, rows: [Self.first, Self.second], chat: fixture.chat)
        XCTAssertEqual(fixture.chat.conversations, [Self.first, Self.second])
        XCTAssertEqual(fixture.chat.historyAlert?.title, "Couldn't delete chat")
    }

    func testPartiallyFailedClearRestoresOnlyTheRowsTheServerKept() async throws {
        let fixture = try await makeChat()
        let clear = fixture.task { await fixture.chat.clearAllConversations() }
        let remove = try await request(fixture.server, "DELETE", "/api/conversations/c1")
        remove.respond()
        let refused = try await request(fixture.server, "DELETE", "/api/conversations/c2")
        refused.respond(status: 503, body: #"{"error":"Refused"}"#)
        let restore = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        restore.respond(rows: [Self.second])
        await clear.value

        XCTAssertEqual(fixture.chat.conversations, [Self.second])
        XCTAssertEqual(fixture.chat.historyAlert?.title, "Some chats weren't deleted")
    }

    func testTeardownRejectsAHeldListResponseAndPreventsFurtherRefreshes() async throws {
        let fixture = try await makeChat()
        let load = fixture.task { await fixture.chat.loadConversations() }
        let held = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)

        fixture.chat.teardown()
        held.respond(rows: [])
        await load.value
        XCTAssertEqual(fixture.chat.conversations, [Self.first, Self.second])
        await fixture.chat.loadConversations()
        fixture.chat.refreshConversationsIfIdle()
        fixture.chat.isHistoryPresented = true

        await expectNoAdditionalListRequest(fixture.server)
    }

    func testErrorStreamDoesNotScheduleASuccessRefresh() async throws {
        let fixture = try await makeChat()
        fixture.chat.seedPendingSend(conversationID: "c1", question: "Who?")
        await fixture.chat.consume(ConversationListRefreshBytes(
            "data: {\"type\":\"start\",\"messageId\":\"a1\"}\n\n"
            + "data: {\"type\":\"error\",\"errorText\":\"[internal] Model unavailable\"}\n\n"
        ))

        await expectNoAdditionalListRequest(fixture.server)
        XCTAssertNotNil(fixture.chat.sendError)
    }

    func testFixtureCloseWaitsForStopAcknowledgementAndAbandonedTransport() async throws {
        let fixture = try await makeChat()
        fixture.server.automaticallyAcknowledgesStop = false
        // An assertion/setup failure must still release a deliberately held ACK
        // before the fixture's earlier asynchronous cleanup block runs.
        let server = fixture.server
        addTeardownBlock { server.releaseStopAcknowledgements() }
        await fixture.chat.switchConversation(to: "c1")
        fixture.chat.input = "Who is Melchizedek?"
        await fixture.chat.send()
        let stream = try await request(fixture.server, "POST", "/api/ask-question")
        let cancelled = stream.transport.expectCancellation()

        // Cleanup itself is deliberately not a fixture caller task: it awaits
        // those tasks and must never wait on itself.
        let closing = Task { await fixture.close() }
        let stop = try await request(fixture.server, "POST", "/api/chat-notifications/stop")
        XCTAssertEqual(fixture.chat.status, .idle)
        XCTAssertFalse(fixture.isClosed, "The session must remain valid while Stop is held")
        XCTAssertFalse(stream.transport.wasCancelled, "Stop must be acknowledged before departure")

        stop.respond(body: #"{"stopped":true}"#)
        let result = await XCTWaiter.fulfillment(of: [cancelled], timeout: 2)
        XCTAssertEqual(result, .completed)
        await closing.value
        XCTAssertTrue(fixture.isClosed)
        XCTAssertTrue(stream.transport.wasCancelled)
        XCTAssertNil(fixture.server.request("POST", "/api/chat-notifications/stop", ordinal: 1))
        // Repeating teardown returns the completed drain without another Stop.
        await fixture.chat.teardown().value
        XCTAssertNil(fixture.server.request("POST", "/api/chat-notifications/stop", ordinal: 1))
    }

    func testFixtureCloseDrainsACancelledManagedListRefreshBeforeInvalidation() async throws {
        let fixture = try await makeChat()
        fixture.chat.isHistoryPresented = true
        let held = try await request(fixture.server, "GET", Self.listPath, ordinal: 1)
        let cancelled = held.transport.expectCancellation()

        let closing = Task { await fixture.close() }
        let result = await XCTWaiter.fulfillment(of: [cancelled], timeout: 2)
        XCTAssertEqual(result, .completed)
        await closing.value
        XCTAssertTrue(fixture.isClosed)
        XCTAssertTrue(held.transport.wasCancelled)
        XCTAssertEqual(fixture.chat.conversations, [Self.first, Self.second])
        held.respond(rows: [])
        XCTAssertEqual(fixture.chat.conversations, [Self.first, Self.second])
    }

    func testStoppedLiveStreamDoesNotScheduleASuccessRefresh() async throws {
        let fixture = try await makeChat()
        await fixture.chat.switchConversation(to: "c1")
        fixture.chat.input = "Who is Melchizedek?"
        await fixture.chat.send()
        let stream = try await request(fixture.server, "POST", "/api/ask-question")

        fixture.chat.stop()
        stream.respond(body: Self.finishedAnswer, contentType: "text/event-stream")

        await expectNoAdditionalListRequest(fixture.server)
        XCTAssertEqual(fixture.chat.status, .idle)
        XCTAssertFalse(fixture.chat.isRecovering)
    }
}

private struct ConversationListRefreshBytes: AsyncSequence, Sendable {
    typealias Element = UInt8
    let bytes: [UInt8]
    init(_ text: String) { bytes = Array(text.utf8) }
    struct Iterator: AsyncIteratorProtocol {
        let bytes: [UInt8]
        var index = 0
        mutating func next() async throws -> UInt8? {
            guard index < bytes.count else { return nil }
            defer { index += 1 }
            return bytes[index]
        }
    }
    func makeAsyncIterator() -> Iterator { Iterator(bytes: bytes) }
}

private final class ConversationListRefreshServer: @unchecked Sendable {
    struct HeldRequest: Sendable {
        let method: String
        let path: String
        let transport: ConversationListRefreshURLProtocol

        func respond(status: Int = 200, body: String = #"{"success":true}"#, contentType: String = "application/json") {
            transport.respond(status: status, body: body, contentType: contentType)
        }

        func respond(rows: [Conversation]) {
            respond(body: String(decoding: try! JSONEncoder().encode(rows), as: UTF8.self))
        }
    }

    private struct AwaitedRequest {
        let method: String
        let path: String
        let ordinal: Int
        let expectation: XCTestExpectation
    }

    let host = "sureword-list-refresh-\(UUID().uuidString.lowercased()).invalid"
    private let lock = NSLock()
    private var recorded: [HeldRequest] = []
    private var awaited: [AwaitedRequest] = []
    private var detail = #"{"messages":[]}"#
    private var autoStop = true

    var automaticallyAcknowledgesStop: Bool {
        get { lock.withLock { autoStop } }
        set { lock.withLock { autoStop = newValue } }
    }

    func releaseStopAcknowledgements() {
        let held = lock.withLock {
            autoStop = true
            return recorded.filter { $0.path == "/api/chat-notifications/stop" }
        }
        for request in held { request.respond(body: #"{"stopped":true}"#) }
    }

    var detailPayload: String {
        get { lock.withLock { detail } }
        set { lock.withLock { detail = newValue } }
    }

    var listRequestCount: Int {
        lock.withLock { recorded.count { $0.method == "GET" && $0.path == "/api/conversations" } }
    }

    func request(_ method: String, _ path: String, ordinal: Int) -> HeldRequest? {
        lock.withLock {
            let matches = recorded.filter { $0.method == method && $0.path == path }
            return matches.indices.contains(ordinal) ? matches[ordinal] : nil
        }
    }

    func expectRequest(_ method: String, _ path: String, ordinal: Int) -> XCTestExpectation {
        let expectation = XCTestExpectation(description: "\(method) \(path) #\(ordinal)")
        lock.withLock {
            if recorded.count(where: { $0.method == method && $0.path == path }) > ordinal {
                expectation.fulfill()
            } else {
                awaited.append(AwaitedRequest(method: method, path: path, ordinal: ordinal, expectation: expectation))
            }
        }
        return expectation
    }

    func receive(_ transport: ConversationListRefreshURLProtocol) {
        let method = transport.request.httpMethod ?? "GET"
        let path = transport.request.url!.path
        let held = HeldRequest(method: method, path: path, transport: transport)
        let automaticBody: String? = lock.withLock {
            recorded.append(held)
            awaited.removeAll { wanted in
                guard recorded.count(where: { $0.method == wanted.method && $0.path == wanted.path }) > wanted.ordinal
                else { return false }
                wanted.expectation.fulfill()
                return true
            }
            if method == "GET", path != "/api/conversations" { return detail }
            if path == "/api/chat-notifications/stop", autoStop { return #"{"stopped":true}"# }
            return nil
        }
        if let automaticBody { held.respond(body: automaticBody) }
    }
}

private final class ConversationListRefreshURLProtocol: URLProtocol, @unchecked Sendable {
    private static let registryLock = NSLock()
    nonisolated(unsafe) private static var servers: [String: ConversationListRefreshServer] = [:]
    private let responseLock = NSLock()
    private var ended = false
    private var cancelled = false
    private var cancellationWaiters: [XCTestExpectation] = []

    var wasCancelled: Bool { responseLock.withLock { cancelled } }

    func expectCancellation() -> XCTestExpectation {
        let expectation = XCTestExpectation(description: "Transport cancelled: \(request.url!.path)")
        responseLock.withLock {
            if cancelled { expectation.fulfill() }
            else { cancellationWaiters.append(expectation) }
        }
        return expectation
    }

    static func register(_ server: ConversationListRefreshServer) {
        registryLock.withLock { servers[server.host] = server }
    }

    static func unregister(_ server: ConversationListRefreshServer) {
        _ = registryLock.withLock { servers.removeValue(forKey: server.host) }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        // This protocol never admits a production host or falls through to DNS
        // for one of its own isolated hosts.
        request.url?.host?.hasSuffix(".invalid") == true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let server = Self.registryLock.withLock { Self.servers[request.url!.host!] }
        guard let server else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        server.receive(self)
    }

    override func stopLoading() {
        let waiters = responseLock.withLock {
            ended = true
            cancelled = true
            let waiting = cancellationWaiters
            cancellationWaiters = []
            return waiting
        }
        waiters.forEach { $0.fulfill() }
    }

    func respond(status: Int, body: String, contentType: String) {
        let shouldRespond = responseLock.withLock {
            guard !ended else { return false }
            ended = true
            return true
        }
        guard shouldRespond else { return }
        let response = HTTPURLResponse(
            url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": contentType]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}
