import UIKit
import UserNotifications
import UserNotificationsUI

/// The long-press view for the Daily Cross and "Your answer is ready": the
/// kind's wide art above its title and text. Apple keeps the header (app icon,
/// name, time) and shows this only when the notification is expanded; the
/// closed banner stays the system's, dressed with a thumbnail by
/// `NotificationService`. `UNNotificationExtensionDefaultContentHidden` hides
/// the default title and body, so this view carries them.
final class NotificationViewController: UIViewController, UNNotificationContentExtension {
    private let banner = UIImageView()
    private let titleLabel = UILabel()
    private let bodyLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()

        banner.contentMode = .scaleAspectFill
        banner.clipsToBounds = true
        banner.layer.cornerRadius = 14
        banner.layer.cornerCurve = .continuous
        banner.isAccessibilityElement = false

        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.numberOfLines = 2
        titleLabel.textColor = .label

        bodyLabel.font = .preferredFont(forTextStyle: .body)
        bodyLabel.adjustsFontForContentSizeCategory = true
        bodyLabel.numberOfLines = 0
        bodyLabel.textColor = .label

        let stack = UIStackView(arrangedSubviews: [banner, titleLabel, bodyLabel])
        stack.axis = .vertical
        stack.spacing = 10
        stack.setCustomSpacing(14, after: banner)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 12),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -16),
            banner.heightAnchor.constraint(equalTo: banner.widthAnchor, multiplier: 9.0 / 16.0),
        ])
    }

    func didReceive(_ notification: UNNotification) {
        let content = notification.request.content
        titleLabel.text = content.title
        bodyLabel.text = content.body
        if let art = NotificationArt(userInfo: content.userInfo) {
            banner.image = Bundle.main.url(forResource: art.bannerResource, withExtension: "jpg")
                .flatMap { UIImage(contentsOfFile: $0.path) }
        }
        banner.isHidden = banner.image == nil
        // Size to the content rather than the Info.plist's initial ratio.
        preferredContentSize = view.systemLayoutSizeFitting(
            CGSize(width: view.bounds.width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
    }
}
