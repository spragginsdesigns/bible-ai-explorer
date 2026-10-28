import Foundation

/// The explorer's three views - Android's `AtlasMode` and the `mode` param of
/// `/study/timeline`. Shared so the Study hub can open the explorer on any of
/// them, on both shells.
enum AtlasExplorerMode: String, CaseIterable, Identifiable, Sendable {
    case timeline, people, places

    var id: String { rawValue }
    var title: String { rawValue.capitalized }

    /// The Study hub page that opens this view, as Android's three Study rows
    /// each push `/study/timeline?mode=`.
    init?(study destination: StudyHubDestination) {
        switch destination {
        case .timeline: self = .timeline
        case .people: self = .people
        case .places: self = .places
        case .notes, .sermons, .words: return nil
        }
    }

    /// Android's header title: the chapter, the directory, or the explorer name.
    static func title(mode: AtlasExplorerMode, chapterScope: (name: String, chapter: Int)?) -> String {
        if let chapterScope { return "\(chapterScope.name) \(chapterScope.chapter)" }
        switch mode {
        case .people: return "People"
        case .places: return "Places"
        case .timeline: return AtlasPresentation.explorerTitle
        }
    }
}

/// One page of the atlas detail column: an entry or an event.
enum AtlasDetailRef: Equatable, Sendable {
    case entity(String)
    case event(String)
}

/// The Mac's detail column back history. Android pushes a screen for every
/// entry opened from another entry's page, so its Back walks the chain; the
/// Mac shows one detail at a time and keeps the chain here instead. Picking
/// from the list starts a new chain, as opening a fresh screen would.
struct AtlasDetailHistory: Equatable, Sendable {
    private(set) var current: AtlasDetailRef?
    private(set) var previous: [AtlasDetailRef] = []

    var canGoBack: Bool { !previous.isEmpty }

    /// Open `ref`. From inside the detail column the shown page is kept to go
    /// back to; from the list, the chain starts over.
    mutating func open(_ ref: AtlasDetailRef, fromDetail: Bool) {
        guard ref != current else { return }
        if fromDetail, let current {
            previous.append(current)
        } else {
            previous = []
        }
        current = ref
    }

    /// Step back one page; returns the page to show, or nil at the start.
    mutating func back() -> AtlasDetailRef? {
        guard let last = previous.popLast() else { return nil }
        current = last
        return last
    }

    mutating func reset() {
        current = nil
        previous = []
    }
}
