import Foundation

/// Port of the `ApiError` class in `mobile/src/lib/api.ts`.
///
/// The offline/timeout distinction exists so the UI can say "you appear to be
/// offline" instead of showing a raw server error — the Android client relies on
/// exactly this split (`isOfflineMessage`).
struct APIError: Error, Equatable {
    var message: String
    var status: Int?
    var isNetworkError = false
    var isTimeout = false
    /// The server's contract code (`rate_limited`, `invalid_input`, ...) when
    /// the error body carried one. `ChatErrors.classify` reads it.
    var code: String? = nil
    /// The body's `plan` (`free` / `pro`), sent only with a used-up daily
    /// allowance so a Free reader can be offered SureWord Pro there.
    var plan: String? = nil

    /// True when the failure is the connection rather than the server.
    var isOffline: Bool { isNetworkError || isTimeout }

    static let timedOut = APIError(
        message: "The request timed out. Check your connection and try again.",
        isTimeout: true
    )

    static let offline = APIError(
        message: "You appear to be offline. Reconnect and try again.",
        isNetworkError: true
    )

    static func server(status: Int, message: String? = nil, code: String? = nil, plan: String? = nil) -> APIError {
        APIError(message: message ?? "Request failed: \(status)", status: status, code: code, plan: plan)
    }
}

extension APIError: LocalizedError {
    var errorDescription: String? { message }
}
