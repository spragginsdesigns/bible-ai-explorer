import CoreGraphics
import Testing

@testable import SureWord

/// Pins where the reader scrolls when a tap opens the verse sheet over the
/// verse it selected (the signed-in run on 2026-10-07 found it hidden).
@Suite("Reader reveal above the verse sheet")
struct ReaderRevealTests {
    // An 800pt reader with a 24pt top inset and a 300pt peek: the uncovered
    // window is 24...500 in viewport coordinates, 36...488 after padding.
    private func target(
        top: CGFloat,
        bottom: CGFloat,
        offset: CGFloat = 1000,
        windowTop: CGFloat = 24,
        windowBottom: CGFloat = 500,
        maxOffset: CGFloat = 5000
    ) -> CGFloat? {
        ReaderReveal.targetOffset(
            rangeTop: top,
            rangeBottom: bottom,
            offset: offset,
            windowTop: windowTop,
            windowBottom: windowBottom,
            minOffset: -24,
            maxOffset: maxOffset
        )
    }

    @Test("a verse already above the sheet does not scroll")
    func visibleStays() {
        #expect(target(top: 1100, bottom: 1160) == nil)
        // Exactly on the padded edges still counts as visible.
        #expect(target(top: 1036, bottom: 1488) == nil)
    }

    @Test("a verse behind the sheet lifts just clear of its top edge")
    func hiddenBehindSheet() {
        // Viewport 600...660, under the sheet (which starts at 500).
        #expect(target(top: 1600, bottom: 1660) == CGFloat(1000 + (660 - 488)))
        // Straddling the sheet's edge counts as hidden too.
        #expect(target(top: 1480, bottom: 1540) == CGFloat(1000 + (540 - 488)))
    }

    @Test("a verse above the top edge comes down just enough")
    func aboveTop() {
        #expect(target(top: 1010, bottom: 1060) == CGFloat(1000 - (36 - 10)))
    }

    @Test("a range taller than the window shows its first verse at the top")
    func tallRange() {
        // 1700...2400 (700pt) cannot fit 452pt: its top lands on the window top.
        #expect(target(top: 1700, bottom: 2400) == CGFloat(1000 + (700 - 36)))
        // A tall range already starting at the window top stays put.
        #expect(target(top: 1036, bottom: 1900) == nil)
    }

    @Test("a range that fits is lifted as a whole")
    func fittingRange() {
        // 1400...1700 is 300pt, fits, bottom at viewport 700.
        #expect(target(top: 1400, bottom: 1700) == CGFloat(1000 + (700 - 488)))
    }

    @Test("the target is clamped to what the scroll view can reach")
    func clamped() {
        // Near the end of the chapter: only 50pt of scroll left.
        #expect(target(top: 1600, bottom: 1660, maxOffset: 1050) == CGFloat(1050))
        // Already at the end, nothing to gain.
        #expect(target(top: 1600, bottom: 1660, maxOffset: 1000) == nil)
        // Near the top: cannot scroll above the top inset.
        #expect(target(top: 0, bottom: 40, offset: 10) == CGFloat(-24))
    }

    @Test("no sensible window (an expanded study view) leaves the reader alone")
    func noWindow() {
        // 24...90 leaves 42pt after padding, which is above the 40pt minimum,
        // so the verse is lifted into the strip...
        #expect(target(top: 1600, bottom: 1630, windowBottom: 90) == CGFloat(1000 + (630 - 78)))
        // ...but a 20pt strip is not worth scrolling for.
        #expect(target(top: 1600, bottom: 1630, windowBottom: 68) == nil)
    }
}
