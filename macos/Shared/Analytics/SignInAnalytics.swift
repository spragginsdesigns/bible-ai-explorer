import ClerkKit
import Foundation

/// The sign-in funnel for the Apple clients: `sign_in_started`,
/// `sign_in_completed` and `sign_in_failed`, carrying the method and, on
/// failure, Clerk's error CODE - the events Android sends from
/// `mobile/app/(auth)/sign-in.tsx`.
///
/// The Apple clients render ClerkKitUI's `AuthView`, which (like the web's
/// prebuilt `<SignIn>`) exposes no per-step callbacks, so this follows the web
/// client's `SignInAnalytics.tsx` instead and watches the two things the
/// component cannot hide:
///
/// - **Clerk's Frontend API responses**, through a `ClerkResponseMiddleware`.
///   Creating a sign-in is a start; a wrong password or code never changes
///   the sign-in resource, it only comes back as a 4xx, so failures are read
///   from those responses.
/// - **Clerk's auth events.** `signInCompleted` is a completion, filed under
///   the first-factor strategy that finished it; that is also how the Google
///   round trip, which completes through the callback URL rather than a POST
///   this middleware sees, is counted.
///
/// Only the request's `strategy` field and the response's error `code` are
/// ever read. The identifier, the password, the code and Clerk's message
/// (which can quote what was typed) never reach an event.
enum SignInAnalytics {
    struct Signal: Equatable {
        var event: String
        var properties: AnalyticsProperties
    }

    /// The method name a Clerk strategy is reported under, matching Android:
    /// `google`, `password`, `email_code` (`apple` for Sign in with Apple's
    /// native token, `oauth_token_apple`).
    static func method(fromStrategy strategy: String?) -> String? {
        guard let strategy, !strategy.isEmpty else { return nil }
        if strategy.hasPrefix("oauth_token_") { return String(strategy.dropFirst("oauth_token_".count)) }
        if strategy.hasPrefix("oauth_") { return String(strategy.dropFirst("oauth_".count)) }
        return strategy
    }

    /// Name one Clerk Frontend API response: nothing when it is not part of a
    /// sign-in. Port of `clerkSignInFailureFrom` (`src/lib/analytics/web-signals.ts`)
    /// plus the start the web reads from the resource instead. Creating an
    /// attempt is always a start, as on Android, where `sign_in_started` is
    /// sent before the lookup and a failed lookup follows it.
    static func signals(
        method httpMethod: String?,
        path: String,
        body: String?,
        status: Int,
        response: Data
    ) -> [Signal] {
        guard httpMethod?.uppercased() == "POST" else { return [] }
        guard let match = path.firstMatch(of: /\/v1\/client\/sign_ins(?:\/[^\/]+\/(attempt_first_factor|prepare_first_factor))?\/?$/) else {
            return []
        }
        let action = match.output.1.map(String.init)
        let strategy = body.flatMap(formValue("strategy"))
        let named = method(fromStrategy: strategy)
        let isOAuth = strategy?.hasPrefix("oauth_") == true

        let ok = (200..<300).contains(status)
        switch action {
        case nil:
            // Creating the attempt: an identifier lookup unless it was an
            // OAuth or native-token start.
            let startMethod = isOAuth ? (named ?? "email") : "email"
            let started = Signal(event: AnalyticsEvents.signInStarted, properties: ["method": .string(startMethod)])
            if ok { return [started] }
            return [started, failure(method: startMethod, step: "lookup", status: status, response: response)]
        case "attempt_first_factor":
            guard !ok else { return [] }
            return [failure(method: named ?? "unknown", step: "verify", status: status, response: response)]
        default:
            guard !ok else { return [] }
            return [failure(method: named ?? "email_code", step: "prepare", status: status, response: response)]
        }
    }

    private static func failure(method: String, step: String, status: Int, response: Data) -> Signal {
        Signal(
            event: AnalyticsEvents.signInFailed,
            properties: [
                "method": .string(method),
                "reason": .string(errorCode(in: response) ?? "http_\(status)"),
                "step": .string(step),
            ]
        )
    }

    /// Clerk's machine-readable reason (`form_password_incorrect`), never its
    /// message.
    static func errorCode(in data: Data) -> String? {
        struct Payload: Decodable {
            struct Item: Decodable { let code: String? }
            let errors: [Item]?
        }
        guard let code = (try? JSONDecoder().decode(Payload.self, from: data))?.errors?.first?.code,
              !code.isEmpty
        else { return nil }
        return code
    }

    /// One field of a form-urlencoded body, read without keeping the rest.
    private static func formValue(_ name: String) -> (String) -> String? {
        { body in
            for pair in body.split(separator: "&") {
                let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                guard parts.count == 2, parts[0] == name else { continue }
                return String(parts[1]).replacingOccurrences(of: "+", with: " ").removingPercentEncoding
            }
            return nil
        }
    }

    /// The completion for one of Clerk's auth events, or nil.
    static func completion(forStrategy strategy: String?, openMethod: String?) -> Signal {
        let method = method(fromStrategy: strategy) ?? openMethod ?? "email"
        return Signal(event: AnalyticsEvents.signInCompleted, properties: ["method": .string(method)])
    }
}

/// Registered with `Clerk.configure` on both apps. Runs before Clerk's own
/// response middleware, so it sees every response, including the 4xx Clerk
/// then turns into a thrown error. It never throws itself: a funnel event is
/// not worth a sign-in.
struct SignInAnalyticsMiddleware: ClerkResponseMiddleware {
    func validate(_ response: HTTPURLResponse, data: Data, for request: URLRequest) async throws {
        guard let url = request.url else { return }
        let body = request.httpBody.flatMap { String(data: $0, encoding: .utf8) }
        let signals = SignInAnalytics.signals(
            method: request.httpMethod,
            path: url.path,
            body: body,
            status: response.statusCode,
            response: data
        )
        guard !signals.isEmpty else { return }
        await MainActor.run {
            for signal in signals {
                if signal.event == AnalyticsEvents.signInStarted, case .string(let method)? = signal.properties["method"] {
                    Analytics.shared.openSignInMethod = method
                }
                Analytics.shared.track(signal.event, signal.properties)
            }
        }
    }
}

extension Analytics {
    /// Follow Clerk's auth events for the life of the app: completions are
    /// counted here. Started from each app root's `.task`.
    func observeSignIns() async {
        for await event in Clerk.shared.auth.events {
            switch event {
            case .signInCompleted(let signIn):
                let signal = SignInAnalytics.completion(
                    forStrategy: signIn.firstFactorVerification?.strategy?.rawValue,
                    openMethod: openSignInMethod
                )
                track(signal.event, signal.properties)
                openSignInMethod = nil
            case .signUpCompleted:
                // A first Google sign-in, or a new email, finishes as a sign-up
                // transfer; it is still the end of the attempt that started.
                let signal = SignInAnalytics.completion(forStrategy: nil, openMethod: openSignInMethod)
                track(signal.event, signal.properties)
                openSignInMethod = nil
            default:
                break
            }
        }
    }
}
