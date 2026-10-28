import Foundation

/// The pure half of the Mac's update check (`SureWord/App/MacUpdateCheck.swift`):
/// reading `GET /api/native-releases`, comparing versions and deciding when
/// to look. The Mac ships as a DMG on GitHub Releases with no auto-updater,
/// so the app only says a newer build exists and links to it; nothing is
/// downloaded or installed for the reader.
///
/// Unconditional rather than macOS-only so the iOS test target pins it
/// (`MacUpdateRulesTests`); nothing on iOS calls it.
enum MacUpdateRules {
    /// One platform's newest downloadable build, as the route serves it
    /// (`src/lib/native-releases.ts`). When GitHub is unreachable the route
    /// answers `version: "Latest"`, which compares as unknown, never newer.
    struct Release: Decodable, Equatable, Sendable {
        let version: String
        let url: URL
    }

    /// The route's body. Only the Mac's entry is read; the Android one is
    /// decoded leniently so a change there can never break this.
    struct Releases: Decodable, Sendable {
        let macos: Release
    }

    static let path = "/api/native-releases"

    /// How long a launch waits before asking again. The About page asks
    /// whenever it is opened.
    static let interval: TimeInterval = 24 * 60 * 60

    /// Dotted numeric versions, compared part by part ("1.10.0" is after
    /// "1.9.2"; "1.2" equals "1.2.0"). A leading "v" is ignored. Nil when
    /// either side is not a version at all, such as the route's "Latest".
    static func compare(_ lhs: String, _ rhs: String) -> ComparisonResult? {
        guard let left = parts(lhs), let right = parts(rhs) else { return nil }
        for index in 0..<max(left.count, right.count) {
            let a = index < left.count ? left[index] : 0
            let b = index < right.count ? right[index] : 0
            if a != b { return a < b ? .orderedAscending : .orderedDescending }
        }
        return .orderedSame
    }

    /// The release worth offering: strictly newer than the running build.
    static func newer(than current: String, latest: Release?) -> Release? {
        guard let latest, compare(latest.version, current) == .orderedDescending else { return nil }
        return latest
    }

    /// Whether a launch should ask: never asked, or asked over a day ago. A
    /// clock moved backwards also asks, rather than waiting out the gap.
    static func isDue(lastChecked: Date?, now: Date) -> Bool {
        guard let lastChecked else { return true }
        let elapsed = now.timeIntervalSince(lastChecked)
        return elapsed >= interval || elapsed < 0
    }

    /// "1.2.3" → [1, 2, 3]. Any part that is not a whole number (a "-beta"
    /// suffix, a word) makes the whole string unreadable.
    private static func parts(_ version: String) -> [Int]? {
        var trimmed = version.trimmingCharacters(in: .whitespaces)
        if trimmed.first == "v" || trimmed.first == "V" { trimmed.removeFirst() }
        let pieces = trimmed.split(separator: ".", omittingEmptySubsequences: false)
        guard !pieces.isEmpty else { return nil }
        var numbers: [Int] = []
        for piece in pieces {
            guard !piece.isEmpty, piece.allSatisfy(\.isNumber), let number = Int(piece) else { return nil }
            numbers.append(number)
        }
        return numbers
    }
}
