import AppKit

/// The editing surface. An `NSTextView` subclass that draws what the character
/// stream must not contain: list bullets and numbers, task checkboxes,
/// blockquote rules and horizontal rules.
///
/// Drawing them instead of inserting them is the whole point. TextEdit-style
/// editors put the bullet in the text, which means every backspace, every
/// select-all-delete and every paste has to be defended against half-eating a
/// marker — and any one that slips through writes a literal "•" into HTML
/// shared with two other clients. Here the text is exactly the document, so the
/// worst a stray edit can do is edit the document.
final class NoteTextView: NSTextView {

    /// Gutter decorations, recomputed whenever the document changes and keyed
    /// by the character offset each paragraph starts at.
    struct Decorations {
        var markers: [Int: String] = [:]
        var quoteDepth: [Int: Int] = [:]
        var rules: Set<Int> = []
        var listIndent: [Int: CGFloat] = [:]
    }

    var decorations = Decorations() {
        didSet { needsDisplay = true }
    }

    var theme: SureWordColors = .dark {
        didSet { needsDisplay = true }
    }

    /// Fired when the user clicks a task checkbox in the gutter.
    var onToggleTask: ((Int) -> Void)?

    // MARK: - Drawing

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        drawDecorations(in: dirtyRect)
    }

    private func drawDecorations(in dirtyRect: NSRect) {
        guard !decorations.markers.isEmpty || !decorations.quoteDepth.isEmpty || !decorations.rules.isEmpty
        else { return }

        let origin = textContainerOrigin
        let containerWidth = textContainer?.size.width ?? bounds.width
        // The gutter is measured from the text container's left edge, NOT from
        // the paragraph frame: `boundingRect(forGlyphRange:in:)` returns the
        // bounds of the *glyphs*, which already begin at the paragraph's head
        // indent. Measuring from there put every bullet on top of the first
        // letter of its own list item.
        let left = origin.x

        enumerateParagraphFrames { offset, frame in
            let top = frame.minY + origin.y
            let height = max(frame.height, 4)
            guard NSRect(x: left, y: top, width: containerWidth, height: height)
                .intersects(dirtyRect) else { return }

            if let depth = decorations.quoteDepth[offset], depth > 0 {
                for level in 0..<depth {
                    let x = left + CGFloat(level) * NoteAttributedText.Metrics.quoteIndent + 3
                    NSColor(theme.accent).withAlphaComponent(0.55).setFill()
                    NSRect(x: x, y: top + 2, width: 2, height: max(height - 4, 4)).fill()
                }
            }

            if decorations.rules.contains(offset) {
                NSColor(theme.borderStrong).setFill()
                NSRect(
                    x: left,
                    y: top + height / 2,
                    width: max(containerWidth - 24, 40),
                    height: 1
                ).fill()
            }

            if let marker = decorations.markers[offset] {
                let indent = decorations.listIndent[offset] ?? NoteAttributedText.Metrics.listIndent
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: NSFont.systemFont(ofSize: NoteAttributedText.Metrics.bodySize - 1),
                    .foregroundColor: NSColor(marker == "☑" ? theme.accent : theme.textFaint),
                ]
                let string = NSAttributedString(string: marker, attributes: attributes)
                let size = string.size()
                // Right-aligned into the gutter the paragraph indent opened up.
                let x = left + indent - size.width - 8
                string.draw(at: NSPoint(x: max(x, left), y: top + 2))
            }
        }
    }

    /// Walks laid-out paragraphs, handing back each one's starting character
    /// offset and its frame in text-container coordinates.
    ///
    /// This is TextKit 1 (`NSLayoutManager.boundingRect(forGlyphRange:in:)`) and
    /// the view is built on a TextKit 1 stack to match. TextKit 2 was tried
    /// first and drew nothing: `NSTextLayoutFragment` enumeration inside
    /// `draw(_:)` did not yield usable frames, so list items indented correctly
    /// but their bullets never appeared. The classic geometry API is the
    /// well-trodden path for gutter drawing and it simply works.
    private func enumerateParagraphFrames(_ body: (Int, NSRect) -> Void) {
        guard let layoutManager = self.layoutManager, let container = textContainer else { return }
        let text = string as NSString
        var offset = 0
        while offset <= text.length {
            let paragraph = text.paragraphRange(
                for: NSRange(location: min(offset, text.length), length: 0)
            )
            let glyphRange = layoutManager.glyphRange(
                forCharacterRange: paragraph,
                actualCharacterRange: nil
            )
            body(offset, layoutManager.boundingRect(forGlyphRange: glyphRange, in: container))
            let next = paragraph.upperBound
            if next <= offset { break }
            offset = next
        }
    }

    // MARK: - Checkbox hit testing

    override var acceptsFirstResponder: Bool { true }

    /// Clicking the body must put the caret in it. Hosted inside a
    /// `NSViewRepresentable`, the click reaches this view but the window does
    /// not always promote it to first responder on its own — verified against
    /// the running app, where a click selected the view without focusing it and
    /// typing went nowhere. Asking for the promotion explicitly is a no-op when
    /// the view already has focus.
    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if let offset = taskMarkerOffset(at: point) {
            if window?.firstResponder !== self { window?.makeFirstResponder(self) }
            onToggleTask?(offset)
            return
        }
        if window?.firstResponder !== self { window?.makeFirstResponder(self) }
        super.mouseDown(with: event)
    }

    private func taskMarkerOffset(at point: NSPoint) -> Int? {
        let origin = textContainerOrigin
        var hit: Int?
        enumerateParagraphFrames { offset, frame in
            guard hit == nil else { return }
            guard let marker = decorations.markers[offset], marker == "☐" || marker == "☑" else { return }
            let indent = decorations.listIndent[offset] ?? NoteAttributedText.Metrics.listIndent
            let rect = NSRect(
                x: frame.minX + origin.x,
                y: frame.minY + origin.y,
                width: indent,
                height: min(frame.height, 26)
            )
            if rect.contains(point) { hit = offset }
        }
        return hit
    }

    // MARK: - Behaviour

    /// Rich text pasted from another app carries fonts, colours and paragraph
    /// styles this model has no representation for — they would render, then
    /// vanish on the next save. Taking the plain string keeps what the user sees
    /// and what the other clients receive in agreement.
    override func paste(_ sender: Any?) {
        pasteAsPlainText(sender)
    }

    /// A note is prose, not source: keep AppKit's substitutions off so what the
    /// user typed is what gets stored.
    func applyDefaults() {
        isRichText = true
        allowsUndo = true
        isEditable = true
        isSelectable = true
        isAutomaticQuoteSubstitutionEnabled = false
        isAutomaticDashSubstitutionEnabled = false
        isAutomaticTextReplacementEnabled = false
        isAutomaticSpellingCorrectionEnabled = false
        isContinuousSpellCheckingEnabled = true
        usesFindBar = true
        isIncrementalSearchingEnabled = true
        drawsBackground = false
        textContainerInset = NSSize(width: 14, height: 18)
        isVerticallyResizable = true
        isHorizontallyResizable = false
        minSize = NSSize(width: 0, height: 0)
        maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        autoresizingMask = [.width]
        textContainer?.widthTracksTextView = true
    }
}
