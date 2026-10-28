import SwiftUI

/// "Is there a newer SureWord for Mac?" The DMG has no auto-updater, so the
/// app asks the public `GET /api/native-releases` (the same lookup the web's
/// download card uses) and, when GitHub has a newer `macos-v*` build, says so
/// with a link to the DMG. No download or install happens in the app.
///
/// Asked at most once a day on launch (the time is kept per install), and
/// every time About is opened. A shared instance, because the launch banner
/// and the About page must agree, and neither belongs to the account.
@MainActor
@Observable
final class MacUpdateCheck {
    static let shared = MacUpdateCheck()

    /// A build newer than this one, once a check has found it.
    private(set) var available: MacUpdateRules.Release?
    private(set) var isChecking = false
    /// The last check that ran failed (offline, or an unreadable answer).
    private(set) var failed = false
    /// True after a launch check found an update the banner has not been
    /// dismissed for, this session.
    private(set) var showsBanner = false

    @ObservationIgnored private let defaults: UserDefaults
    static let lastCheckedKey = "mac.update.lastChecked"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The launch check: skipped when a check ran within the day.
    func checkOnLaunchIfDue(now: Date = .now) async {
        let last = defaults.object(forKey: Self.lastCheckedKey) as? Date
        guard MacUpdateRules.isDue(lastChecked: last, now: now) else { return }
        await check()
        if available != nil { showsBanner = true }
    }

    /// Ask now. About calls this every time it opens.
    func check() async {
        guard !isChecking else { return }
        isChecking = true
        defer { isChecking = false }
        do {
            let url = Config.apiURL.appending(path: MacUpdateRules.path)
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            let releases = try JSONDecoder().decode(MacUpdateRules.Releases.self, from: data)
            available = MacUpdateRules.newer(than: Config.appVersion, latest: releases.macos)
            failed = false
            defaults.set(Date.now, forKey: Self.lastCheckedKey)
        } catch {
            failed = true
        }
    }

    func dismissBanner() {
        showsBanner = false
    }
}

/// The launch notice: a slim bar over the window's content, dismissible,
/// never a modal. `MainWindow` hides it while Walk with me is running.
struct MacUpdateBanner: View {
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL
    let release: MacUpdateRules.Release
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "arrow.down.circle.fill")
                .appFont(.system(size: 15))
                .foregroundStyle(theme.accent)
                .accessibilityHidden(true)
            Text("A new version is available (\(release.version)).")
                .appFont(.system(size: 13, weight: .medium))
                .foregroundStyle(theme.text)
            Spacer(minLength: Spacing.md)
            Button("Download") { openURL(release.url) }
                .buttonStyle(AccentButtonStyle())
            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(SubtleButtonStyle())
            .help("Dismiss")
            .accessibilityLabel("Dismiss update notice")
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
        .background(theme.bgElevated)
        .overlay(alignment: .bottom) { Divider().overlay(theme.border) }
    }
}

/// Settings → About's update rows: the result of asking just now. The host
/// starts the check (`check.check()`) when the page opens.
struct MacUpdateRow: View {
    @Environment(\.theme) private var theme
    @Environment(\.openURL) private var openURL
    let check: MacUpdateCheck

    var body: some View {
        Group {
            if let release = check.available {
                LabeledContent("A new version is available (\(release.version))") {
                    Button("Download") { openURL(release.url) }
                }
                Text("Downloads the new SureWord.dmg in your browser. Open it and drag SureWord to Applications to replace this version.")
                    .appFont(.system(size: 11))
                    .foregroundStyle(theme.textGhost)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if check.isChecking {
                LabeledContent("Updates") { ProgressView().controlSize(.small) }
            } else if check.failed {
                LabeledContent("Updates") {
                    Button("Check again") { Task { await check.check() } }
                }
                Text("Couldn't check for updates. Check your connection and try again.")
                    .appFont(.system(size: 11))
                    .foregroundStyle(theme.textGhost)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                LabeledContent("Updates", value: "SureWord is up to date")
            }
        }
    }
}
