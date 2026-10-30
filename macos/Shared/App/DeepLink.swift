import Foundation

extension Notification.Name {
    /// Posted (object: the reference string, e.g. "John 3:16") when a
    /// `sureword://verse?ref=…` deep link arrives. The iOS TabShell and the Mac
    /// window observe it and hand the reference to the reader; on Android the same journey
    /// is the `/bible/chapter?verse=` link.
    static let openVerseReference = Notification.Name("sureword.openVerseReference")

    /// Posted (object: the conversation id) when a "your answer is ready" push
    /// is tapped. Android's equivalent is `router.push("/", { conversationId })`.
    static let openConversation = Notification.Name("sureword.openConversation")
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
    /// A tapped "your answer is ready" push: open that conversation. Comes only
    /// from a notification payload, never from a URL.
    case chat(String)

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

/// Each native arrival is queued once, then adopted by one shell before any
/// save wait. Failed saves retain that exact request; retries never renew it.
@MainActor
final class PendingDeepLinks {
    static let shared = PendingDeepLinks()
    private static let eventKey = "sureword.deepLinkEventID"

    struct Event: Equatable, Identifiable, Sendable {
        let id: UUID
        let link: DeepLink
    }

    struct Arrival {
        fileprivate let event: Event
        fileprivate let generation: UUID
    }

    struct Delivery: Equatable {
        let event: Event
        let ownerID: UUID
        let request: AppModel.NoteNavigationRequest
    }

    private let center: NotificationCenter
    private var pending: [Event] = []
    private var deliveries: [UUID: Delivery] = [:]
    private var delayedArrivalGeneration = UUID()
    private var latestEventID: UUID?
    private var lastPublishedID: UUID?

    init(center: NotificationCenter = .default) { self.center = center }

    var events: [Event] { pending }
    func event(id: UUID) -> Event? { pending.first { $0.id == id } }

    static func eventID(from notification: Notification) -> UUID? {
        notification.userInfo?[eventKey] as? UUID
    }

    /// Prepare before Clerk's async URL handling. A later explicit intent or
    /// newer native arrival makes a delayed completion ineligible to publish.
    func prepare(_ link: DeepLink) -> Arrival {
        delayedArrivalGeneration = UUID()
        let event = Event(id: UUID(), link: link)
        latestEventID = event.id
        return Arrival(event: event, generation: delayedArrivalGeneration)
    }

    func invalidateDelayedArrivals() { delayedArrivalGeneration = UUID() }

    @discardableResult
    func post(_ link: DeepLink) -> Event {
        let arrival = prepare(link)
        publish(arrival.event)
        return arrival.event
    }

    @discardableResult
    func post(_ arrival: Arrival) -> Event? {
        guard arrival.generation == delayedArrivalGeneration,
              latestEventID == arrival.event.id, lastPublishedID != arrival.event.id else { return nil }
        publish(arrival.event)
        return arrival.event
    }

    private func publish(_ event: Event) {
        guard lastPublishedID != event.id else { return }
        lastPublishedID = event.id
        pending.append(event)
        let userInfo: [String: Any] = [Self.eventKey: event.id]
        switch event.link {
        case .cross:
            center.post(name: .openDailyCross, object: nil, userInfo: userInfo)
        case .verse(let reference):
            center.post(name: .openVerseReference, object: reference, userInfo: userInfo)
        case .chat(let conversationID):
            center.post(name: .openConversation, object: conversationID, userInfo: userInfo)
        }
    }

    func adopt(
        _ event: Event, ownerID: UUID, allowNewIntent: Bool = true,
        makeRequest: @MainActor () -> AppModel.NoteNavigationRequest
    ) -> Delivery? {
        guard pending.contains(event) else { return nil }
        guard latestEventID == event.id else { discard(event.id); return nil }
        if let existing = deliveries[event.id] {
            return existing.ownerID == ownerID ? existing : nil
        }
        // Startup must not promote a cold event after the user already chose
        // another route. An already-adopted failed save retains its request.
        guard allowNewIntent else { discard(event.id); return nil }
        let delivery = Delivery(event: event, ownerID: ownerID, request: makeRequest())
        deliveries[event.id] = delivery
        return delivery
    }

    @discardableResult
    func perform(
        _ delivery: Delivery,
        isCurrent: @MainActor (AppModel.NoteNavigationRequest) -> Bool,
        departure: NoteDepartureCoordinator,
        action: @MainActor (DeepLink) -> Bool
    ) async -> Bool {
        var applied = false
        await delivery.request.perform(isCurrent: {
            isCurrent(delivery.request) && self.contains(delivery)
        }, departure: departure) {
            // An invalid/declined action is retired after authorization too;
            // only a failed departure keeps a current delivery for retry.
            applied = action(delivery.event.link)
            self.discard(delivery.event.id)
        }
        // Save failure alone keeps a current event pending. Supersession or
        // a session clear cannot revive it on a later startup/retry.
        if !isCurrent(delivery.request) || latestEventID != delivery.event.id {
            discard(delivery.event.id)
        }
        return applied
    }

    private func contains(_ delivery: Delivery) -> Bool {
        latestEventID == delivery.event.id && pending.contains(delivery.event)
            && deliveries[delivery.event.id] == delivery
    }

    func discard(_ id: UUID) {
        pending.removeAll { $0.id == id }
        deliveries[id] = nil
    }

    /// Explicit session invalidation and legacy test readback. Production
    /// delivery acknowledges individual events only after guarded commit.
    func drain() -> [DeepLink] {
        let links = pending.map(\.link)
        pending = []
        deliveries = [:]
        latestEventID = nil
        invalidateDelayedArrivals()
        return links
    }
}
