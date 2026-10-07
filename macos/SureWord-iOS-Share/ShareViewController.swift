import SwiftUI
import UIKit

/// The share extension's principal class (`NSExtensionPrincipalClass`). Saves
/// the share into the App Group inbox, then hands off to the app.
///
/// The hand-off is App Review-safe on purpose: it uses only the public
/// `NSExtensionContext.open(_:)`, and never walks the responder chain to reach
/// `UIApplication` (the common trick, which relies on private behaviour and
/// broke in iOS 18). The system decides whether a share extension may open
/// its app; when it may not, the sheet says the share is waiting in SureWord
/// and the app opens it the next time it comes to the foreground.
final class ShareViewController: UIViewController {
    private let model = ShareExtensionModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareExtensionView(model: model) { [weak self] in
            self?.finish()
        })
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        host.didMove(toParent: self)

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        Task { @MainActor in
            await model.save(items)
            guard case .saved = model.state else { return }
            openApp()
        }
    }

    private func openApp() {
        extensionContext?.open(PendingShare.openURL) { [weak self] opened in
            guard opened else { return }
            Task { @MainActor in self?.finish() }
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}

@MainActor
@Observable
final class ShareExtensionModel {
    enum State: Equatable {
        case saving
        /// What was saved, e.g. "A voice message and text".
        case saved(String)
        case failed(String)
    }

    private(set) var state: State = .saving

    func save(_ items: [NSExtensionItem]) async {
        guard let store = PendingShareStore.appGroup() else {
            state = .failed("SureWord could not save this share. Open SureWord and attach it from the + button instead.")
            return
        }
        let id = UUID().uuidString
        do {
            let directory = try store.makeShareDirectory(id: id)
            let collected = await ShareCollector.collect(items, into: directory)
            guard !collected.isEmpty else {
                store.discard(id: id)
                state = .failed("Nothing in that share could be opened in SureWord.")
                return
            }
            try store.commit(collected.manifest(id: id))
            state = .saved(collected.summary)
        } catch {
            store.discard(id: id)
            state = .failed("SureWord could not save this share. Please try again.")
        }
    }
}

/// A small card over the host app: saving, then "waiting in SureWord", and
/// a Done button. Deliberately plain - no Clerk, no network, no app theme
/// module - so the extension stays tiny and starts instantly.
struct ShareExtensionView: View {
    let model: ShareExtensionModel
    let onDone: () -> Void

    /// The brand gold (`theme.accent` in the app).
    private let gold = Color(red: 0.83, green: 0.66, blue: 0.29)

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Image(systemName: "sun.horizon.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(gold)
                    Text("SureWord")
                        .font(.system(size: 20, weight: .semibold, design: .serif))
                    Spacer()
                }
                content
                Button(action: onDone) {
                    Text("Done")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .foregroundStyle(Color.black)
                        .background(gold, in: .rect(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .disabled(model.state == .saving)
                .opacity(model.state == .saving ? 0.5 : 1)
                .accessibilityIdentifier("share-done")
            }
            .padding(20)
            .background(.regularMaterial, in: .rect(cornerRadius: 22))
            .padding(16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .saving:
            HStack(spacing: 10) {
                ProgressView()
                Text("Saving to SureWord…").foregroundStyle(.secondary)
            }
        case .saved(let summary):
            VStack(alignment: .leading, spacing: 6) {
                Label("Saved to SureWord", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 15, weight: .medium))
                    .symbolRenderingMode(.multicolor)
                    .accessibilityIdentifier("share-saved")
                Text(summary + ".")
                    .font(.system(size: 14))
                Text("Open SureWord to check it against Scripture or get help replying. It opens as a new chat, after you sign in if you need to.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("share-failed")
        }
    }
}
