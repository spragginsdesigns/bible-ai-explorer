import Foundation

/// Supplies a Clerk session JWT. `fresh` skips Clerk's token cache.
typealias TokenProvider = @Sendable (_ fresh: Bool) async throws -> String?

/// HTTP client for the shared SureWord backend — a port of
/// `mobile/src/lib/api.ts`, including its 401 retry and offline handling.
///
/// The retry matters: Clerk hands out short-lived JWTs, and a cached one that
/// expired mid-session would otherwise surface to the user as a hard failure.
/// One retry with a fresh token fixes the common case; a *second* 401 means the
/// session itself is invalid (e.g. issued by a different Clerk instance) and only
/// a real sign-in can fix it, so the auth-failure handler signs out locally.
/// Without that, the app renders "signed in" forever while every call 401s.
final class APIClient: Sendable {
    static let defaultTimeout: TimeInterval = 30
    /// Streaming endpoints hold the body open for as long as the model writes,
    /// so this bounds only the time until the first response headers arrive.
    static let streamTimeout: TimeInterval = 45
    /// A 10 MB attachment on a slow link needs more than the REST budget.
    static let uploadTimeout: TimeInterval = 120

    private let baseURL: URL
    private let token: TokenProvider
    private let session: URLSession
    private let authFailure: AuthFailureReporter

    init(
        baseURL: URL = Config.apiURL,
        token: @escaping TokenProvider,
        onAuthFailure: @escaping @Sendable () async -> Void
    ) {
        self.baseURL = baseURL
        self.token = token
        self.authFailure = AuthFailureReporter(handler: onAuthFailure)

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = Self.defaultTimeout
        configuration.waitsForConnectivity = false
        self.session = URLSession(configuration: configuration)
    }

    // MARK: - JSON

    /// JSON helper for the REST endpoints (conversations, notes, folders, tags,
    /// memories). Mirrors `apiJson` in the Android client.
    func json<Response: Decodable>(
        _ path: String,
        method: String = "GET",
        body: (any Encodable)? = nil,
        timeout: TimeInterval = defaultTimeout,
        as type: Response.Type = Response.self
    ) async throws -> Response {
        let data = try await data(path, method: method, body: body, timeout: timeout)
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError(message: "The server sent a response we couldn't read.")
        }
    }

    /// Same request path as `json`, without decoding — for endpoints whose body
    /// is ignored or shaped dynamically.
    @discardableResult
    func data(
        _ path: String,
        method: String = "GET",
        body: (any Encodable)? = nil,
        timeout: TimeInterval = defaultTimeout
    ) async throws -> Data {
        var result = try await attempt(path, method: method, body: body, timeout: timeout, fresh: false)
        if result.status == 401 {
            result = try await attempt(path, method: method, body: body, timeout: timeout, fresh: true)
        }
        if result.status == 401 {
            await authFailure.report()
        }

        guard (200..<300).contains(result.status) else {
            throw APIError.server(status: result.status, message: Self.errorMessage(in: result.data))
        }
        return result.data
    }

    private func attempt(
        _ path: String,
        method: String,
        body: (any Encodable)?,
        timeout: TimeInterval,
        fresh: Bool
    ) async throws -> (status: Int, data: Data) {
        var request = try await makeRequest(path, method: method, fresh: fresh)
        request.timeoutInterval = timeout
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        do {
            let (data, response) = try await session.data(for: request)
            return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
        } catch {
            throw Self.translate(error)
        }
    }

    // MARK: - Streaming

    /// Open a streaming POST (`/api/ask-question`). Returns the raw byte stream
    /// for `UIMessageStreamDecoder` to consume.
    ///
    /// The 401 retry applies to opening the stream only — once bytes flow the
    /// token has already been accepted.
    func stream(
        _ path: String,
        body: some Encodable
    ) async throws -> URLSession.AsyncBytes {
        func open(fresh: Bool) async throws -> (URLSession.AsyncBytes, HTTPURLResponse) {
            var request = try await makeRequest(path, method: "POST", fresh: fresh)
            request.timeoutInterval = Self.streamTimeout
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            request.httpBody = try JSONEncoder().encode(body)
            do {
                let (bytes, response) = try await session.bytes(for: request)
                return (bytes, (response as? HTTPURLResponse) ?? HTTPURLResponse())
            } catch {
                throw Self.translate(error)
            }
        }

        var (bytes, response) = try await open(fresh: false)
        if response.statusCode == 401 {
            (bytes, response) = try await open(fresh: true)
        }
        if response.statusCode == 401 {
            await authFailure.report()
        }

        guard (200..<300).contains(response.statusCode) else {
            // Drain the short error body so the message survives into the UI.
            var payload = Data()
            for try await byte in bytes { payload.append(byte) }
            throw APIError.server(status: response.statusCode, message: Self.errorMessage(in: payload))
        }
        return bytes
    }

    // MARK: - Blob upload

    /// PUT raw bytes to an absolute presigned URL.
    ///
    /// Deliberately unauthenticated: the signature is in the URL, the host is
    /// Vercel Blob rather than our API, and sending a Clerk bearer to a third
    /// party would leak it. Uploads get their own timeout because a 10 MB file on
    /// a slow link legitimately outlasts `defaultTimeout`.
    func upload(to url: URL, data: Data, contentType: String) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.timeoutInterval = Self.uploadTimeout
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")

        do {
            let (body, response) = try await session.upload(for: request, from: data)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(status) else {
                throw APIError.server(status: status, message: Self.errorMessage(in: body))
            }
        } catch {
            throw Self.translate(error)
        }
    }

    // MARK: - Plumbing

    private func makeRequest(_ path: String, method: String, fresh: Bool) async throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError(message: "Invalid request path: \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let jwt = try? await token(fresh) {
            request.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// The API answers errors as `{ "error": "..." }`; surface that text.
    private static func errorMessage(in data: Data) -> String? {
        struct Payload: Decodable { let error: String? }
        return try? JSONDecoder().decode(Payload.self, from: data).error
    }

    private static func translate(_ error: any Error) -> APIError {
        if let apiError = error as? APIError { return apiError }
        let code = (error as NSError).code
        guard (error as NSError).domain == NSURLErrorDomain else {
            return APIError(message: error.localizedDescription)
        }
        switch code {
        case NSURLErrorTimedOut:
            return .timedOut
        case NSURLErrorNotConnectedToInternet,
             NSURLErrorNetworkConnectionLost,
             NSURLErrorCannotConnectToHost,
             NSURLErrorCannotFindHost,
             NSURLErrorDataNotAllowed,
             NSURLErrorInternationalRoamingOff:
            return .offline
        case NSURLErrorCancelled:
            return APIError(message: "Cancelled")
        default:
            return APIError(message: error.localizedDescription, isNetworkError: true)
        }
    }
}

/// Throttles the local sign-out so a burst of failing requests fires it once.
/// Matches the Android client's 30-second window.
private actor AuthFailureReporter {
    private let handler: @Sendable () async -> Void
    private var lastFiredAt: Date?

    init(handler: @escaping @Sendable () async -> Void) {
        self.handler = handler
    }

    func report() async {
        let now = Date()
        if let lastFiredAt, now.timeIntervalSince(lastFiredAt) < 30 { return }
        lastFiredAt = now
        await handler()
    }
}
