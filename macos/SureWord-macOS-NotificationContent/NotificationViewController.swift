import AppKit
import UserNotifications
import UserNotificationsUI

/// The Mac's expanded notification: bundled wide art, then the title and body.
/// The system keeps its header and forwards notification taps to the app.
final class NotificationViewController: NSViewController, UNNotificationContentExtension {
    private let banner = NSImageView()
    private let titleLabel = NSTextField(wrappingLabelWithString: "")
    private let bodyLabel = NSTextField(wrappingLabelWithString: "")
    private let stack = NSStackView()

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 300))
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        banner.imageScaling = .scaleProportionallyUpOrDown
        banner.wantsLayer = true
        banner.layer?.cornerRadius = 14
        banner.layer?.masksToBounds = true
        banner.setAccessibilityElement(false)

        titleLabel.font = .preferredFont(forTextStyle: .headline, options: [:])
        titleLabel.maximumNumberOfLines = 2
        bodyLabel.font = .preferredFont(forTextStyle: .body, options: [:])
        bodyLabel.maximumNumberOfLines = 0
        for label in [titleLabel, bodyLabel] {
            label.textColor = .labelColor
            label.lineBreakMode = .byWordWrapping
            label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            label.setContentCompressionResistancePriority(.required, for: .vertical)
        }

        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.detachesHiddenViews = true
        stack.translatesAutoresizingMaskIntoConstraints = false
        for item in [banner, titleLabel, bodyLabel] {
            item.translatesAutoresizingMaskIntoConstraints = false
            stack.addArrangedSubview(item)
            item.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
        stack.setCustomSpacing(14, after: banner)
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 12),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            banner.heightAnchor.constraint(equalTo: banner.widthAnchor, multiplier: 9.0 / 16.0),
        ])
    }

    func didReceive(_ notification: UNNotification) {
        loadViewIfNeeded()
        let content = notification.request.content
        titleLabel.stringValue = content.title
        bodyLabel.stringValue = content.body
        // A controller can receive another notification while visible. Clear
        // the previous image before resolving this notification's kind.
        banner.image = NotificationArt(userInfo: content.userInfo)
            .flatMap { Bundle.main.url(forResource: $0.bannerResource, withExtension: "jpg") }
            .flatMap { NSImage(contentsOf: $0) }
        banner.isHidden = banner.image == nil
        view.needsLayout = true
        view.layoutSubtreeIfNeeded()
    }

    override func viewDidLayout() {
        super.viewDidLayout()
        let contentWidth = max(1, view.bounds.width - 28)
        for label in [titleLabel, bodyLabel] where label.preferredMaxLayoutWidth != contentWidth {
            label.preferredMaxLayoutWidth = contentWidth
        }
        let height = ceil(stack.fittingSize.height + 28)
        if abs(preferredContentSize.height - height) > 0.5 {
            preferredContentSize = NSSize(width: view.bounds.width, height: height)
        }
    }
}
