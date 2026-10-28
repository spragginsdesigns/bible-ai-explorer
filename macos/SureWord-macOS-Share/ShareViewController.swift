import AppKit
import SwiftUI

/// The Mac share extension's principal class (`NSExtensionPrincipalClass`):
/// "SureWord" in the Share menu of Safari, Photos, Voice Memos, Finder, Notes
/// and the rest. Saves the share into the App Group inbox with the same
/// collector and caps as iOS (`ShareInbox/`), then opens SureWord, which takes
/// it as a new chat exactly as it takes a Services or drag-and-drop share
/// (`MacShareInbox`).
///
/// The hand-off opens `sureword://share` with the app this extension is
/// embedded in, not whichever app claims the scheme, so a stray older build
/// elsewhere on disk never receives it. When SureWord cannot be opened the
/// sheet says the share is waiting, and the app opens it the next time it
/// comes forward.
final class ShareViewController: NSViewController {
    private let model = ShareExtensionModel()

    override func loadView() {
        let host = NSHostingView(rootView: ShareExtensionView(model: model) { [weak self] in
            self?.finish()
        })
        // The share sheet sizes itself to the card.
        host.sizingOptions = [.preferredContentSize]
        view = host
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        Task { @MainActor in
            await model.save(items)
            guard case .saved = model.state else { return }
            openApp()
        }
    }

    /// `…/SureWord.app/Contents/PlugIns/SureWordShare.appex` → `SureWord.app`.
    private static var containingApp: URL? {
        let app = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return app.pathExtension == "app" ? app : nil
    }

    private func openApp() {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        let opened: @Sendable (NSRunningApplication?, (any Error)?) -> Void = { [weak self] _, error in
            guard error == nil else { return }
            Task { @MainActor in self?.finish() }
        }
        if let app = Self.containingApp {
            NSWorkspace.shared.open([PendingShare.openURL], withApplicationAt: app, configuration: configuration, completionHandler: opened)
        } else {
            NSWorkspace.shared.open(PendingShare.openURL, configuration: configuration, completionHandler: opened)
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}

/// The iOS extension's model (`SureWord-iOS-Share/ShareViewController.swift`),
/// with the Mac's name for the attach button.
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
            state = .failed("SureWord could not save this share. Open SureWord and attach it from the paperclip button instead.")
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

/// The iOS card, as the content of the Mac's share sheet: saving, then
/// "waiting in SureWord", and a Done button. Deliberately plain - no Clerk, no
/// network, no app theme module - so the extension stays tiny and starts
/// instantly.
struct ShareExtensionView: View {
    let model: ShareExtensionModel
    let onDone: () -> Void

    /// The brand gold (`theme.accent` in the app).
    private let gold = Color(red: 0.83, green: 0.66, blue: 0.29)

    var body: some View {
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
                    .font(.system(size: 14, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .foregroundStyle(Color.black)
                    .background(gold, in: .rect(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.defaultAction)
            .disabled(model.state == .saving)
            .opacity(model.state == .saving ? 0.5 : 1)
            .accessibilityIdentifier("share-done")
        }
        .padding(20)
        .frame(width: 360)
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .saving:
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text("Saving to SureWord…").foregroundStyle(.secondary)
            }
        case .saved(let summary):
            VStack(alignment: .leading, spacing: 6) {
                Label("Saved to SureWord", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 14, weight: .medium))
                    .symbolRenderingMode(.multicolor)
                    .accessibilityIdentifier("share-saved")
                Text(summary + ".")
                    .font(.system(size: 13))
                Text("Open SureWord to check it against Scripture or get help replying. It opens as a new chat, after you sign in if you need to.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("share-failed")
        }
    }
}
