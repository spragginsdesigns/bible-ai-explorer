import Foundation
import UserNotifications

/// Each kind of SureWord notification has its own art, so the Daily Cross and
/// "Your answer is ready" never read alike: a cross before the rising day star,
/// and the open Word with a speech balloon. Mirrors `notificationArtFor` in
/// `src/lib/push-routing.ts` (Android draws the same art in the
/// `sureword-notifications` module).
///
/// Compiled into the apps (their local notices) and into both iOS
/// notification extensions: the Service Extension attaches `mark` as the
/// banner thumbnail, the Content Extension draws `banner` on long-press.
/// Foundation and UserNotifications only, so it is extension-safe.
enum NotificationArt: String, CaseIterable, Sendable {
    case cross
    case answer

    /// The `screen` every SureWord notification carries for tap routing.
    /// Like `NotificationTapTarget`, it reads Expo's nesting under "body" as
    /// well as the top level (that type is not extension-safe to share).
    init?(userInfo: [AnyHashable: Any]) {
        let data = (userInfo["body"] as? [AnyHashable: Any]) ?? userInfo
        switch data["screen"] as? String {
        case "cross": self = .cross
        case "chat": self = .answer
        default: return nil
        }
    }

    /// The category the server sends (`apnsCategoryFor`), which picks the
    /// Content Extension's long-press view.
    var categoryIdentifier: String {
        switch self {
        case .cross: "SUREWORD_CROSS"
        case .answer: "SUREWORD_ANSWER"
        }
    }

    /// Square mark: the banner thumbnail.
    var markResource: String { "\(rawValue)-mark" }
    /// Wide piece: the long-press view.
    var bannerResource: String { "\(rawValue)-wide" }

    /// Both categories, registered at launch so the Content Extension's
    /// categories are known to the system. No actions: a tap opens the app.
    static var categories: Set<UNNotificationCategory> {
        Set(allCases.map {
            UNNotificationCategory(identifier: $0.categoryIdentifier, actions: [], intentIdentifiers: [], options: [])
        })
    }

    /// The mark as an attachment, or nil when the art is missing.
    ///
    /// The system takes ownership of an attachment's file, and a bundle is
    /// read-only, so it gets a private copy in the temporary directory.
    func markAttachment(in bundle: Bundle = .main) -> UNNotificationAttachment? {
        guard let source = bundle.url(forResource: markResource, withExtension: "jpg") else { return nil }
        let copy = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(markResource)-\(UUID().uuidString).jpg")
        do {
            try FileManager.default.copyItem(at: source, to: copy)
            return try UNNotificationAttachment(identifier: markResource, url: copy, options: nil)
        } catch {
            try? FileManager.default.removeItem(at: copy)
            return nil
        }
    }

    /// Dress a notice: its category and, when the art is bundled, its thumbnail.
    func dress(_ content: UNMutableNotificationContent, bundle: Bundle = .main) {
        content.categoryIdentifier = categoryIdentifier
        if let attachment = markAttachment(in: bundle) {
            content.attachments = [attachment]
        }
    }
}
