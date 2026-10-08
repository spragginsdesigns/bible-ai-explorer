import Foundation

/// Chat error classification - a port of `mobile/src/features/chat/chatErrors.ts`.
///
/// The server speaks a shared error contract (see `/api/ask-question`):
/// pre-stream failures are JSON `{ error, code }` (the code survives on
/// `APIError.code`), mid-stream SSE error chunks serialize as `[code] message`.
/// Older servers send neither, so classification falls back to the HTTP
/// status, then to network/timeout detection, then to a generic internal
/// error. The copy table is Android's, word for word.
enum ChatErrorCode: String, Sendable, Equatable, CaseIterable {
    case unauthorized
    case invalidInput = "invalid_input"
    case conversationNotFound = "conversation_not_found"
    /// An Edit or "Try again" the server refused because the stored thread
    /// has rows this device never saw. Retrying means reloading, not resending.
    case staleThread = "stale_thread"
    case providerKeyMissing = "provider_key_missing"
    case providerError = "provider_error"
    case rateLimited = "rate_limited"
    /// Client-side: the request never reached the server.
    case offline
    /// Client-side: the request timed out.
    case timeout
    case `internal`

    /// The server's fixed enum - the two client-side codes are never parsed
    /// out of a body or a `[code]` prefix.
    static let serverCodes: Set<ChatErrorCode> = [
        .unauthorized, .invalidInput, .conversationNotFound, .staleThread, .providerKeyMissing,
        .providerError, .rateLimited, .internal,
    ]

    init?(serverCode raw: String) {
        guard let code = ChatErrorCode(rawValue: raw), Self.serverCodes.contains(code) else {
            return nil
        }
        self = code
    }
}

struct ClassifiedChatError: Sendable, Equatable {
    var code: ChatErrorCode
    var title: String
    var message: String
    /// Whether "Try again" is offered. Retrying a refused sign-in or an
    /// invalid message would only fail the same way.
    var retryable: Bool
}

enum ChatErrors {
    struct Copy: Sendable, Equatable {
        let title: String
        let message: String
        let retryable: Bool
    }

    static let copy: [ChatErrorCode: Copy] = [
        .offline: Copy(
            title: "You're offline",
            message: "You appear to be offline. Reconnect and try again.",
            retryable: true
        ),
        .timeout: Copy(
            title: "The request timed out",
            message: "The request timed out. Check your connection and try again.",
            retryable: true
        ),
        .unauthorized: Copy(
            title: "Sign in again",
            message: "Your session could not be verified. Sign in again to keep chatting.",
            retryable: false
        ),
        .invalidInput: Copy(
            title: "That message could not be sent",
            message: "The server could not use that message. Edit it and try again.",
            retryable: false
        ),
        .conversationNotFound: Copy(
            title: "Conversation not found",
            message: "This conversation is no longer available. Start a new chat to continue.",
            retryable: false
        ),
        .staleThread: Copy(
            title: "This chat changed",
            message: "This conversation changed on another device. Reload it and try again.",
            retryable: true
        ),
        .providerKeyMissing: Copy(
            title: "The AI provider is not configured",
            message: "The AI provider is not set up right now. Try again later.",
            retryable: false
        ),
        .providerError: Copy(
            title: "The AI provider had a problem",
            message: "The AI provider could not answer. Try again.",
            retryable: true
        ),
        .rateLimited: Copy(
            title: "Too many requests",
            message: "You've reached the request limit. Try again in a moment.",
            retryable: true
        ),
        .internal: Copy(
            title: "Something went wrong",
            message: "Something went wrong while answering. Try again.",
            retryable: true
        ),
    ]

    /// Strip a mid-stream `[code] message` prefix. Unknown bracket tags are
    /// left alone - they are more likely message text than a server code.
    static func parseCodePrefix(_ text: String) -> (code: ChatErrorCode, rest: String)? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("["), let close = trimmed.firstIndex(of: "]") else { return nil }
        let tag = trimmed[trimmed.index(after: trimmed.startIndex)..<close]
        guard !tag.isEmpty,
              tag.allSatisfy({ $0 == "_" || ("a"..."z").contains($0) }),
              let code = ChatErrorCode(serverCode: String(tag))
        else { return nil }
        let rest = trimmed[trimmed.index(after: close)...].drop { $0.isWhitespace }
        return (code, String(rest))
    }

    /// Parse a pre-stream `{ "error": "...", "code": "..." }` body that
    /// arrived as raw text, which keeps literal JSON off the screen.
    static func parseJSONBody(_ text: String) -> (code: ChatErrorCode?, message: String?)? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{"),
              let data = trimmed.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        let code = (object["code"] as? String).flatMap(ChatErrorCode.init(serverCode:))
        let message = object["error"] as? String
        if code == nil && message == nil { return nil }
        return (code, message)
    }

    /// A message worth showing verbatim: short, human, not serialized data.
    static func looksFriendly(_ text: String?) -> Bool {
        guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty, trimmed.count <= 300
        else { return false }
        if trimmed.hasPrefix("{") || trimmed.hasPrefix("<") { return false }
        // APIClient's own fallback when the server sent no message at all.
        if trimmed.hasPrefix("Request failed: "),
           trimmed.dropFirst("Request failed: ".count).allSatisfy(\.isNumber),
           trimmed.count > "Request failed: ".count {
            return false
        }
        return true
    }

    static func build(
        _ code: ChatErrorCode,
        serverMessage: String?,
        override: String? = nil
    ) -> ClassifiedChatError {
        let copy = Self.copy[code] ?? Self.copy[.internal]!
        let message: String
        if let override {
            message = override
        } else if looksFriendly(serverMessage), let serverMessage {
            message = serverMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            message = copy.message
        }
        return ClassifiedChatError(code: code, title: copy.title, message: message, retryable: copy.retryable)
    }

    /// Classify anything the chat pipeline can throw. Order follows the shared
    /// contract: JSON body code, `[code]` prefix, HTTP status, network/timeout
    /// detection, then a generic internal fallback.
    static func classify(_ error: (any Error)?, message override: String? = nil) -> ClassifiedChatError {
        let apiError = error as? APIError
        let raw: String
        if let apiError {
            raw = apiError.message
        } else if let error {
            raw = error.localizedDescription
        } else {
            raw = ""
        }

        // (a) A contract code wins over everything else: decoded off the body
        // by APIClient, or still inside a raw JSON string.
        let json = parseJSONBody(raw)
        if let code = apiError?.code.flatMap(ChatErrorCode.init(serverCode:)) ?? json?.code {
            return build(code, serverMessage: json?.message ?? raw, override: override)
        }

        // (b) Mid-stream SSE error chunk: `[code] message`.
        if let prefixed = parseCodePrefix(json?.message ?? raw) {
            return build(prefixed.code, serverMessage: prefixed.rest, override: override)
        }

        // (c) HTTP status, for old servers that send no code at all.
        if let status = apiError?.status {
            let message = json?.message ?? raw
            switch status {
            case 400: return build(.invalidInput, serverMessage: message, override: override)
            case 401: return build(.unauthorized, serverMessage: message, override: override)
            case 404: return build(.conversationNotFound, serverMessage: message, override: override)
            case 429: return build(.rateLimited, serverMessage: message, override: override)
            default: return build(.internal, serverMessage: message, override: override)
            }
        }

        // (d) Network/timeout detection - these never carry a status.
        if apiError?.isTimeout == true { return build(.timeout, serverMessage: nil, override: override) }
        if apiError?.isNetworkError == true { return build(.offline, serverMessage: nil, override: override) }
        if let error, apiError == nil, (error as NSError).domain == NSURLErrorDomain {
            let timedOut = (error as NSError).code == NSURLErrorTimedOut
            return build(timedOut ? .timeout : .offline, serverMessage: nil, override: override)
        }
        let lowered = raw.lowercased()
        if lowered.contains("network request failed") || lowered.contains("failed to fetch") {
            return build(.offline, serverMessage: nil, override: override)
        }

        // Fallback: keep an old server's bare message if it is human-readable.
        return build(.internal, serverMessage: json?.message ?? raw, override: override)
    }

    /// A bare string from the stream (an `error` chunk's `errorText`) or an
    /// old server - Android's `classifyChatError("...")`.
    static func classify(text: String, message override: String? = nil) -> ClassifiedChatError {
        classify(APIError(message: text), message: override)
    }

    /// The recovery poll outlasted the server's own answer budget. Retrying the
    /// question is the honest option at that point.
    static let recoveryExhausted = ClassifiedChatError(
        code: .internal,
        title: "The answer did not arrive",
        message: AnswerRecovery.exhaustedError,
        retryable: true
    )
}
