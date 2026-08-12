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
        enumerateParagraphFrames { offset, frame in
            let rect = frame.offsetBy(dx: origin.x, dy: origin.y)
            guard rect.intersects(dirtyRect.insetBy(dx: 0, dy: -rect.height)) else { return }

            if let depth = decorations.quoteDepth[offset], depth > 0 {
                for level in 0..<depth {
                    let x = rect.minX + CGFloat(level) * NoteAttributedText.Metrics.quoteIndent + 3
                    NSColor(theme.accent).withAlphaComponent(0.55).setFill()
                    NSRect(x: x, y: rect.minY + 2, width: 2, height: max(rect.height - 4, 4)).fill()
                }
            }

            if decorations.rules.contains(offset) {
                NSColor(theme.borderStrong).setFill()
                NSRect(
                    x: rect.minX,
                    y: rect.midY,
                    width: max(rect.width - 24, 40),
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
                let x = rect.minX + indent - size.width - 8
                string.draw(at: NSPoint(x: max(x, rect.minX), y: rect.minY + 2))
            }
        }
    }

    /// Walks laid-out paragraphs, handing back each one's starting character
    /// offset and its frame in text-container coordinates. Written against
    /// TextKit 2, which is what `NSTextView` uses on macOS 15, with a TextKit 1
    /// fallback for the case where something forced the compatibility path.
    private func enumerateParagraphFrames(_ body: (Int, NSRect) -> Void) {
        if let layoutManager = textLayoutManager, let content = layoutManager.textContentManager {
            layoutManager.enumerateTextLayoutFragments(
                from: layoutManager.documentRange.location,
                options: [.ensuresLayout]
            ) { fragment in
                let offset = content.offset(
                    from: content.documentRange.location,
                    to: fragment.rangeInElement.location
                )
                body(offset, fragment.layoutFragmentFrame)
                return true
            }
            return
        }

        guard let layoutManager = self.layoutManager, let container = textContainer else { return }
        let text = string as NSString
        var offset = 0
        while offset <= text.length {
            let paragraph = text.paragraphRange(for: NSRange(location: offset, length: 0))
            let glyphRange = layoutManager.glyphRange(forCharacterRange: paragraph, actualCharacterRange: nil)
            body(offset, layoutManager.boundingRect(forGlyphRange: glyphRange, in: container))
            if paragraph.upperBound <= offset { break }
            offset = paragraph.upperBound
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
