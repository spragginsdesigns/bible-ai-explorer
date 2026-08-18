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

    static func server(status: Int, message: String? = nil) -> APIError {
        APIError(message: message ?? "Request failed: \(status)", status: status)
    }
}

extension APIError: LocalizedError {
    var errorDescription: String? { message }
}
