import Foundation
import XCTest
@testable import SureWord

/// History search, rename and confirmed delete (LC-16612): the rules shared by
/// the Mac sidebar, the Mac history picker and the iOS history sheet, and the
/// `PATCH` / `DELETE /api/conversations/{id}` requests behind them, driven
/// through `ChatViewModel` against a stubbed server.
final class ConversationHistoryTests: XCTestCase {
    private let conversations = [
        Conversation(id: "1", title: "Grace in Romans", createdAt: ""),
        Conversation(id: "2", title: "", createdAt: ""),
        Conversation(id: "3", title: "Psalm 23", createdAt: ""),
    ]

    // MARK: Search

    func testSearchMatchesTheShownTitleCaseInsensitively() {
        XCTAssertEqual(HistorySearch.filter(conversations, query: "").map(\.id), ["1", "2", "3"])
        XCTAssertEqual(HistorySearch.filter(conversations, query: "   ").map(\.id), ["1", "2", "3"])
        XCTAssertEqual(HistorySearch.filter(conversations, query: "  ROMANS ").map(\.id), ["1"])
        XCTAssertEqual(HistorySearch.filter(conversations, query: "untitled").map(\.id), ["2"])
        XCTAssertEqual(HistorySearch.filter(conversations, query: "Ephesians").map(\.id), [])
        XCTAssertEqual(HistorySearch.displayTitle(conversations[1]), "Untitled conversation")
    }

    func testNoMatchesReadsAsAndroidsEmptyState() {
        XCTAssertEqual(HistorySearch.noMatches("  Ephesians "), "No conversations match “Ephesians”.")
    }

    // MARK: Rename rules

    func testRenameCollapsesWhitespaceTheWayTheRouteDoes() {
        XCTAssertEqual(ConversationRename.normalized("  Grace \n in\tRomans  "), "Grace in Romans")
        XCTAssertEqual(ConversationRename.normalized("   "), "")
    }

    /// JavaScript's `\s` works on code points: a byte order mark is a space,
    /// NEL is not, and a space before a combining mark still collapses.
    func testRenameWhitespaceIsJavaScriptsNotSwiftsCharacters() {
        XCTAssertEqual(ConversationRename.normalized("\u{FEFF}Grace\u{FEFF}\u{FEFF}Romans"), "Grace Romans")
        XCTAssertEqual(ConversationRename.normalized("Grace\u{85}Romans"), "Grace\u{85}Romans")
        XCTAssertEqual(ConversationRename.normalized("a  \u{301}b"), "a \u{301}b")
        XCTAssertEqual(ConversationRename.normalized("Grace\u{00A0}\u{3000}in\u{2028}Romans"), "Grace in Romans")
    }

    func testRenameLimitIsTheRoutesAndCountsUTF16LikeJavaScript() {
        XCTAssertEqual(ConversationRename.maxLength, 120)
        let ascii = String(repeating: "a", count: 130)
        XCTAssertEqual(ConversationRename.clamped(ascii).utf16.count, 120)
        // An emoji is two UTF-16 units: 61 of them are 122 to the route, so
        // the field keeps 60 and never splits one in half.
        let emoji = String(repeating: "🙏", count: 61)
        XCTAssertEqual(ConversationRename.clamped(emoji), String(repeating: "🙏", count: 60))
        XCTAssertEqual(ConversationRename.clamped("Psalm 23"), "Psalm 23")
    }

    func testRenameSendsNothingBlankOrUnchanged() {
        XCTAssertNil(ConversationRename.titleToSend("   ", current: "Psalm 23"))
        XCTAssertNil(ConversationRename.titleToSend(" Psalm  23 ", current: "Psalm 23"))
        XCTAssertEqual(ConversationRename.titleToSend(" The  Lord is my shepherd ", current: "Psalm 23"), "The Lord is my shepherd")
        XCTAssertEqual(ConversationRename.titleToSend(String(repeating: "a", count: 200), current: "")?.count, 120)
    }

    func testRenameBodyIsTheTitleOnly() throws {
        let data = try JSONEncoder().encode(ConversationRename.Body(title: "Grace in Romans"))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        XCTAssertEqual(object, ["title": "Grace in Romans"])
    }

    func testDeleteConfirmationNamesTheConversation() {
        XCTAssertEqual(ConversationDeletion.title, "Delete this conversation?")
        XCTAssertEqual(
            ConversationDeletion.message(for: conversations[0]),
            "“Grace in Romans” will be deleted. This cannot be undone."
        )
        XCTAssertEqual(
            ConversationDeletion.message(for: conversations[1]),
            "“Untitled conversation” will be deleted. This cannot be undone."
        )
    }

    // MARK: Requests through ChatViewModel

    @MainActor
    private func makeChat() async -> ChatViewModel {
        HistoryServer.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [HistoryServer.self]
        let client = APIClient(
            baseURL: URL(string: "https://sureword-history.invalid")!,
            token: { _ in nil },
            onAuthFailure: {},
            session: URLSession(configuration: configuration)
        )
        let chat = ChatViewModel(api: client, settings: SettingsStore())
        await chat.loadConversations()
        return chat
    }

    @MainActor
    func testRenamePatchesTheNormalizedTitleAndShowsIt() async throws {
        let chat = await makeChat()
        let error = await chat.renameConversation("ok", to: "  Grace \n in Romans ")
        XCTAssertNil(error)
        XCTAssertEqual(chat.conversations.first { $0.id == "ok" }?.title, "Grace in Romans")
        let request = try XCTUnwrap(HistoryServer.requests.last)
        XCTAssertEqual(request.method, "PATCH")
        XCTAssertEqual(request.path, "/api/conversations/ok")
        XCTAssertEqual(request.json, ["title": "Grace in Romans"])
        chat.teardown()
    }

    @MainActor
    func testRefusedRenameKeepsTheTitleAndSaysSo() async {
        let chat = await makeChat()
        let error = await chat.renameConversation("refused", to: "New name")
        XCTAssertEqual(error, "Couldn't rename. Try again.")
        XCTAssertEqual(chat.conversations.first { $0.id == "refused" }?.title, "Refused chat")
        chat.teardown()
    }

    @MainActor
    func testBlankRenameSendsNothing() async {
        let chat = await makeChat()
        let before = HistoryServer.requests.count
        let error = await chat.renameConversation("ok", to: " \n ")
        XCTAssertNil(error)
        XCTAssertEqual(HistoryServer.requests.count, before)
        chat.teardown()
    }

    @MainActor
    func testDeletingTheOpenConversationClosesIt() async {
        let chat = await makeChat()
        await chat.switchConversation(to: "ok")
        XCTAssertEqual(chat.activeConversationID, "ok")

        await chat.deleteConversation("ok")

        XCTAssertNil(chat.activeConversationID)
        XCTAssertTrue(chat.messages.isEmpty)
        XCTAssertFalse(chat.conversations.contains { $0.id == "ok" })
        XCTAssertNil(chat.historyAlert)
        XCTAssertTrue(HistoryServer.requests.contains { $0.method == "DELETE" && $0.path == "/api/conversations/ok" })
        chat.teardown()
    }

    @MainActor
    func testDeletingAnotherConversationLeavesTheOpenOne() async {
        let chat = await makeChat()
        await chat.switchConversation(to: "refused")
        await chat.deleteConversation("ok")
        XCTAssertEqual(chat.activeConversationID, "refused")
        chat.teardown()
    }

    @MainActor
    func testRefusedDeleteRestoresTheListAndAlerts() async {
        let chat = await makeChat()
        await chat.deleteConversation("refused")
        XCTAssertTrue(chat.conversations.contains { $0.id == "refused" })
        XCTAssertEqual(chat.historyAlert?.title, "Couldn't delete chat")
        chat.teardown()
    }
}

/// A stand-in for the conversation routes. `ok` accepts every write and
/// `refused` answers 503, the way `NoteDeletionTests` stubs its route; the
/// list always lists both.
private final class HistoryServer: URLProtocol, @unchecked Sendable {
    struct Request: Sendable {
        let method: String
        let path: String
        let json: [String: String]?
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var recorded: [Request] = []

    static var requests: [Request] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    static func reset() {
        lock.lock()
        recorded = []
        lock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "sureword-history.invalid"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url!
        let method = request.httpMethod ?? "GET"
        let body = Self.body(of: request)
        let json = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }
        Self.lock.lock()
        Self.recorded.append(Request(method: method, path: url.path, json: json))
        Self.lock.unlock()

        let status: Int
        let payload: String
        switch (method, url.path) {
        case ("GET", "/api/conversations"):
            status = 200
            payload = #"[{"id":"ok","title":"Psalm 23","createdAt":"2026-10-18T00:00:00.000Z"},{"id":"refused","title":"Refused chat","createdAt":"2026-10-17T00:00:00.000Z"}]"#
        case ("GET", _):
            status = 200
            payload = #"{"id":"ok","messages":[]}"#
        case (_, "/api/conversations/ok"):
            status = 200
            payload = method == "DELETE"
                ? #"{"success":true}"#
                : #"{"id":"ok","title":"Grace in Romans","createdAt":"2026-10-18T00:00:00.000Z","updatedAt":"2026-10-18T00:00:00.000Z"}"#
        default:
            status = 503
            payload = #"{"error":"Internal server error"}"#
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(payload.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    /// URLSession hands a protocol the body as a stream, not as `httpBody`.
    private static func body(of request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
