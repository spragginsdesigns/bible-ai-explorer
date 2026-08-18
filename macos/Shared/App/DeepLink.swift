import Foundation

extension Notification.Name {
    /// Posted (object: the reference string, e.g. "John 3:16") when a
    /// `sureword://verse?ref=…` deep link arrives. The iOS TabShell observes it
    /// and hands the reference to the Bible model; on Android the same journey
    /// is the `/bible/chapter?verse=` link.
    static let openVerseReference = Notification.Name("sureword.openVerseReference")
}

/// A `sureword://` deep link that belongs to the app itself rather than to
/// Clerk's OAuth return (`sureword://sso-callback`, which `Clerk.handle`
/// claims first).
///
/// Android equivalents: the `/cross` route and the `?verse=` reader link
/// (`mobile/app/(app)/cross.tsx`, `mobile/src/features/chat/verseLinks.ts`).
enum DeepLink: Equatable, Sendable {
    /// `sureword://cross` — open the Daily Cross.
    case cross
    /// `sureword://verse?ref=John%203:16` — open the reader at a reference.
    /// The string is deliberately kept raw; resolution through
    /// `Bible.resolveReference` happens where the reader lives.
    case verse(String)

    static func parse(_ url: URL) -> DeepLink? {
        guard url.scheme == Config.redirectScheme,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }

        // In a custom-scheme URL the route lands in the host position:
        // sureword://cross → host "cross".
        let route = (components.host ?? "").lowercased()
        switch route {
        case "cross":
            return .cross
        case "verse":
            guard let reference = components.queryItems?
                .first(where: { $0.name == "ref" })?
                .value?
                .trimmingCharacters(in: .whitespacesAndNewlines),
                !reference.isEmpty
            else { return nil }
            return .verse(reference)
        default:
            // sso-callback and anything unknown belong to someone else.
            return nil
        }
    }
}

/// Buffers deep links that arrive before the signed-in shell exists, and
/// re-broadcasts them as notifications for when it does.
///
/// The cold-start case is real: tapping the morning notification launches the
/// app, the app delegate fires immediately, but TabShell only appears once
/// Clerk has restored the session — a bare `NotificationCenter.post` would be
/// missed. So every link is both posted (the live path the observers
/// subscribe to) and held here for TabShell to drain on its first appearance.
@MainActor
final class PendingDeepLinks {
    static let shared = PendingDeepLinks()

    private var pending: [DeepLink] = []

    private init() {}

    func post(_ link: DeepLink) {
        pending.append(link)
        switch link {
        case .cross:
            NotificationCenter.default.post(name: .openDailyCross, object: nil)
        case .verse(let reference):
            NotificationCenter.default.post(name: .openVerseReference, object: reference)
        }
    }

    /// Everything buffered so far, oldest first, clearing the buffer. Called
    /// once by the shell when it first appears; links handled live through
    /// the notifications are idempotent (opening an already-open sheet,
    /// re-selecting the same chapter), so a rare double-delivery is harmless.
    func drain() -> [DeepLink] {
        defer { pending.removeAll() }
        return pending
    }
}
