import CoreGraphics

/// Where the reader scrolls so a tapped verse is not left behind the verse
/// sheet. The sheet is an overlay over the bottom of the chapter, so a verse
/// tapped low on the screen used to end up under the peek it opened.
///
/// Pure geometry, so it is pinned by `ReaderRevealTests`. Everything is in
/// scroll-content coordinates except the window, which is in viewport
/// coordinates (0 is the top edge of the scroll view).
enum ReaderReveal {
    /// Space kept between the verse and the window's edges (the sheet's top,
    /// the scroll view's top inset).
    static let padding: CGFloat = 12
    /// Below this much uncovered reader there is nowhere sensible to show the
    /// verse (an expanded study view on a short screen), so leave it alone.
    static let minimumWindow: CGFloat = 40

    /// The content offset to scroll to, or nil when the selection is already
    /// visible or there is no room to show it.
    ///
    /// - Parameters:
    ///   - rangeTop: top of the selection's first verse, content coordinates.
    ///   - rangeBottom: bottom of its last verse, content coordinates.
    ///   - offset: the scroll view's current content offset.
    ///   - windowTop: first uncovered viewport y (the top content inset).
    ///   - windowBottom: last uncovered viewport y (the sheet's top edge).
    ///   - minOffset: smallest reachable offset (minus the top inset).
    ///   - maxOffset: largest reachable offset.
    static func targetOffset(
        rangeTop: CGFloat,
        rangeBottom: CGFloat,
        offset: CGFloat,
        windowTop: CGFloat,
        windowBottom: CGFloat,
        minOffset: CGFloat,
        maxOffset: CGFloat
    ) -> CGFloat? {
        let top = windowTop + padding
        let bottom = windowBottom - padding
        guard bottom - top >= minimumWindow, rangeBottom >= rangeTop else { return nil }

        let verseTop = rangeTop - offset
        let verseBottom = rangeBottom - offset
        if verseTop >= top, verseBottom <= bottom { return nil }

        let target: CGFloat
        if verseBottom - verseTop > bottom - top {
            // Taller than the window: the top of the range is what reads.
            target = offset + (verseTop - top)
        } else if verseBottom > bottom {
            // Below (behind the sheet): lift it just clear of the sheet.
            target = offset + (verseBottom - bottom)
        } else {
            // Above the top edge: bring it down just enough.
            target = offset - (top - verseTop)
        }

        let clamped = min(max(target, minOffset), max(maxOffset, minOffset))
        return abs(clamped - offset) < 1 ? nil : clamped
    }
}
