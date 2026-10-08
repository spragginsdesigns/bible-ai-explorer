import Foundation
import Testing
@testable import SureWord

/// Ported from `mobile/src/features/chat/chatErrors.test.ts`, case for case,
/// plus the Swift-only inputs (`APIError.code`, a bare `URLError`).
@Suite("Chat errors")
struct ChatErrorsTests {

    // MARK: parseCodePrefix

    @Test("Parses a [code] prefix and strips it from the message")
    func parsesPrefix() throws {
        let parsed = try #require(ChatErrors.parseCodePrefix("[rate_limited] Slow down."))
        #expect(parsed.code == .rateLimited)
        #expect(parsed.rest == "Slow down.")
    }

    @Test("Ignores bracket tags that are not server codes")
    func ignoresUnknownTags() {
        #expect(ChatErrors.parseCodePrefix("[note] see above") == nil)
        // Client-side codes are never parsed out of server text.
        #expect(ChatErrors.parseCodePrefix("[offline] nope") == nil)
    }

    @Test("Returns nil without a prefix")
    func noPrefix() {
        #expect(ChatErrors.parseCodePrefix("plain message") == nil)
    }

    // MARK: classify

    @Test("Uses the code from a JSON error body (raw transport body)")
    func jsonBodyCode() {
        let classified = ChatErrors.classify(
            text: #"{"error":"That reference is not in the Bible.","code":"invalid_input"}"#
        )
        #expect(classified.code == .invalidInput)
        #expect(classified.message == "That reference is not in the Bible.")
        #expect(classified.retryable == false)
    }

    @Test("Uses the code APIClient decoded off the error body")
    func apiErrorCode() {
        let classified = ChatErrors.classify(
            APIError.server(status: 400, message: "That reference is not in the Bible.", code: "invalid_input")
        )
        #expect(classified.code == .invalidInput)
        #expect(classified.title == "That message could not be sent")
        #expect(classified.message == "That reference is not in the Bible.")
        #expect(!classified.retryable)
    }

    @Test("Uses the code from a mid-stream [code] chunk")
    func midStreamChunk() {
        let classified = ChatErrors.classify(text: "[provider_error] The model overloaded.")
        #expect(classified.code == .providerError)
        #expect(classified.message == "The model overloaded.")
        #expect(classified.retryable)
    }

    @Test("Maps a 401 to unauthorized")
    func unauthorized() {
        let classified = ChatErrors.classify(APIError.server(status: 401, message: "Unauthorized"))
        #expect(classified.code == .unauthorized)
        #expect(classified.title == "Sign in again")
        #expect(!classified.retryable)
    }

    @Test("Maps a 429 to rate_limited and keeps the server message")
    func rateLimited() {
        let classified = ChatErrors.classify(APIError.server(status: 429, message: "Too many questions today."))
        #expect(classified.code == .rateLimited)
        #expect(classified.message == "Too many questions today.")
        #expect(classified.retryable)
    }

    @Test("Maps a 500 to internal")
    func internalError() {
        let classified = ChatErrors.classify(APIError.server(status: 500, message: "boom"))
        #expect(classified.code == .internal)
        #expect(classified.retryable)
    }

    @Test("Maps 400 and 404 by status when there is no code")
    func statusFallbacks() {
        #expect(ChatErrors.classify(APIError.server(status: 400)).code == .invalidInput)
        #expect(ChatErrors.classify(APIError.server(status: 404)).code == .conversationNotFound)
    }

    @Test("Never shows APIClient's 'Request failed: N' fallback")
    func requestFailedHidden() {
        let classified = ChatErrors.classify(APIError.server(status: 502))
        #expect(classified.message == "Something went wrong while answering. Try again.")
    }

    @Test("Maps a network error to offline")
    func offline() {
        let classified = ChatErrors.classify(APIError.offline)
        #expect(classified.code == .offline)
        #expect(classified.title == "You're offline")
        #expect(classified.message == "You appear to be offline. Reconnect and try again.")
        #expect(classified.retryable)
    }

    @Test("Maps a timeout to timeout")
    func timeout() {
        let classified = ChatErrors.classify(APIError.timedOut)
        #expect(classified.code == .timeout)
        #expect(classified.message == "The request timed out. Check your connection and try again.")
        #expect(classified.retryable)
    }

    @Test("Maps a raw URLError to offline or timeout")
    func rawURLError() {
        #expect(ChatErrors.classify(URLError(.networkConnectionLost)).code == .offline)
        #expect(ChatErrors.classify(URLError(.timedOut)).code == .timeout)
    }

    @Test("Maps a 'Network request failed' message to offline")
    func networkMessage() {
        #expect(ChatErrors.classify(text: "Network request failed").code == .offline)
    }

    @Test("Falls back to internal with the bare message from an old server")
    func bareMessage() {
        let classified = ChatErrors.classify(text: "Something unexpected happened.")
        #expect(classified.code == .internal)
        #expect(classified.message == "Something unexpected happened.")
    }

    @Test("Keeps an old server's bare JSON error message without a code")
    func bareJSONMessage() {
        let classified = ChatErrors.classify(
            APIError(message: #"{"error":"We could not answer that."}"#, status: 500)
        )
        #expect(classified.code == .internal)
        #expect(classified.message == "We could not answer that.")
    }

    @Test("Never shows raw JSON to the user")
    func neverRawJSON() {
        let classified = ChatErrors.classify(text: #"{"unexpected":true,"trace":"abc"}"#)
        #expect(classified.code == .internal)
        #expect(!classified.message.contains("{"))
    }

    @Test("Never shows HTML or a wall of text")
    func neverHTMLOrLongText() {
        #expect(ChatErrors.classify(text: "<html>502</html>").message == ChatErrors.copy[.internal]?.message)
        #expect(
            ChatErrors.classify(text: String(repeating: "a", count: 301)).message
                == ChatErrors.copy[.internal]?.message
        )
    }

    @Test("Prefers the override message when given")
    func overrideMessage() {
        let classified = ChatErrors.classify(
            APIError.server(status: 500, message: "boom"),
            message: "Couldn't start the conversation. Check your connection and try again."
        )
        #expect(classified.message == "Couldn't start the conversation. Check your connection and try again.")
        #expect(classified.title == "Something went wrong")
    }

    @Test("Classifies unknown input as internal")
    func unknownInput() {
        #expect(ChatErrors.classify(nil).code == .internal)
        #expect(ChatErrors.classify(text: "").code == .internal)
        #expect(ChatErrors.classify(text: "").message == "Something went wrong while answering. Try again.")
    }

    // MARK: copy table

    @Test("Carries Android's copy table exactly")
    func copyTable() {
        let expected: [ChatErrorCode: (String, String, Bool)] = [
            .offline: ("You're offline", "You appear to be offline. Reconnect and try again.", true),
            .timeout: ("The request timed out", "The request timed out. Check your connection and try again.", true),
            .unauthorized: ("Sign in again", "Your session could not be verified. Sign in again to keep chatting.", false),
            .invalidInput: ("That message could not be sent", "The server could not use that message. Edit it and try again.", false),
            .conversationNotFound: ("Conversation not found", "This conversation is no longer available. Start a new chat to continue.", false),
            .providerKeyMissing: ("The AI provider is not configured", "The AI provider is not set up right now. Try again later.", false),
            .providerError: ("The AI provider had a problem", "The AI provider could not answer. Try again.", true),
            .rateLimited: ("Too many requests", "You've reached the request limit. Try again in a moment.", true),
            .internal: ("Something went wrong", "Something went wrong while answering. Try again.", true),
        ]
        #expect(ChatErrors.copy.count == ChatErrorCode.allCases.count)
        for (code, (title, message, retryable)) in expected {
            #expect(ChatErrors.copy[code]?.title == title, "\(code)")
            #expect(ChatErrors.copy[code]?.message == message, "\(code)")
            #expect(ChatErrors.copy[code]?.retryable == retryable, "\(code)")
        }
    }

    @Test("The recovery-exhausted error keeps the existing copy and stays retryable")
    func recoveryExhausted() {
        let classified = ChatErrors.recoveryExhausted
        #expect(classified.title == "The answer did not arrive")
        #expect(classified.message == "We couldn't retrieve that answer. Retry to ask again.")
        #expect(classified.retryable)
    }
}
