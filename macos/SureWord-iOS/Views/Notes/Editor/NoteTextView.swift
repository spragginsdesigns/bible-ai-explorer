import UIKit

/// The editing surface. A `UITextView` subclass that draws what the character
/// stream must not contain: list bullets and numbers, task checkboxes,
/// blockquote rules and horizontal rules.
///
/// Drawing them instead of inserting them is the whole point — same argument as
/// the macOS `NoteTextView`: if the bullet were text, every backspace and every
/// select-all-delete would have to be defended against half-eating a marker,
/// and any one that slipped through would write a literal "•" into HTML shared
/// with two other clients. Here the text is exactly the document, so the worst
/// a stray edit can do is edit the document.
final class NoteTextView: UITextView {

    /// Gutter decorations, recomputed whenever the document changes and keyed
    /// by the character offset each paragraph starts at.
    struct Decorations {
        var markers: [Int: String] = [:]
        var quoteDepth: [Int: Int] = [:]
        var rules: Set<Int> = []
        var listIndent: [Int: CGFloat] = [:]
    }

    var decorations = Decorations() {
        didSet { setNeedsDisplay() }
    }

    var theme: SureWordColors = .dark {
        didSet { setNeedsDisplay() }
    }

    /// Fired when the user taps a task checkbox in the gutter.
    var onToggleTask: ((Int) -> Void)?

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        observeKeyboard()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("NoteTextView is built in code")
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Drawing

    override func draw(_ rect: CGRect) {
        super.draw(rect)
        drawDecorations(in: rect)
    }

    private func drawDecorations(in dirtyRect: CGRect) {
        guard !decorations.markers.isEmpty || !decorations.quoteDepth.isEmpty || !decorations.rules.isEmpty
        else { return }

        let origin = CGPoint(
            x: textContainerInset.left + textContainer.lineFragmentPadding,
            y: textContainerInset.top
        )
        let containerWidth = textContainer.size.width
        let left = origin.x

        enumerateParagraphFrames { offset, frame in
            let top = frame.minY + origin.y
            let height = max(frame.height, 4)
            guard CGRect(x: left, y: top, width: containerWidth, height: height)
                .intersects(dirtyRect) else { return }

            if let depth = decorations.quoteDepth[offset], depth > 0 {
                for level in 0..<depth {
                    let x = left + CGFloat(level) * NoteAttributedText.Metrics.quoteIndent + 3
                    UIColor(theme.accent).withAlphaComponent(0.55).setFill()
                    UIRectFill(CGRect(x: x, y: top + 2, width: 2, height: max(height - 4, 4)))
                }
            }

            if decorations.rules.contains(offset) {
                UIColor(theme.borderStrong).setFill()
                UIRectFill(
                    CGRect(
                        x: left,
                        y: top + height / 2,
                        width: max(containerWidth - 24, 40),
                        height: 1
                    )
                )
            }

            if let marker = decorations.markers[offset] {
                let indent = decorations.listIndent[offset] ?? NoteAttributedText.Metrics.listIndent
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: NoteAttributedText.Metrics.bodySize - 1),
                    .foregroundColor: UIColor(marker == "☑" ? theme.accent : theme.textFaint),
                ]
                let string = NSAttributedString(string: marker, attributes: attributes)
                let size = string.size()
                // Right-aligned into the gutter the paragraph indent opened up.
                let x = left + indent - size.width - 8
                string.draw(at: CGPoint(x: max(x, left), y: top + 2))
            }
        }
    }

    /// Walks laid-out paragraphs, handing back each one's starting character
    /// offset and its frame in text-container coordinates — the same TextKit 1
    /// geometry calls the macOS view settled on (see its `NoteTextView` for why
    /// TextKit 2 fragment enumeration was abandoned).
    private func enumerateParagraphFrames(_ body: (Int, CGRect) -> Void) {
        let container = textContainer
        let text = text as NSString
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

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let point = touches.first?.location(in: self),
           let offset = taskMarkerOffset(at: point) {
            onToggleTask?(offset)
            return
        }
        super.touchesBegan(touches, with: event)
    }

    private func taskMarkerOffset(at point: CGPoint) -> Int? {
        let origin = CGPoint(x: textContainerInset.left, y: textContainerInset.top)
        var hit: Int?
        enumerateParagraphFrames { offset, frame in
            guard hit == nil else { return }
            guard let marker = decorations.markers[offset], marker == "☐" || marker == "☑" else { return }
            let indent = decorations.listIndent[offset] ?? NoteAttributedText.Metrics.listIndent
            let rect = CGRect(
                x: frame.minX + origin.x,
                y: frame.minY + origin.y,
                width: indent,
                height: min(frame.height, 30)
            )
            if rect.contains(point) { hit = offset }
        }
        return hit
    }

    // MARK: - Paste

    /// Rich text pasted from another app carries fonts, colours and paragraph
    /// styles this model has no representation for — they would render, then
    /// vanish on the next save. Taking the plain string keeps what the user sees
    /// and what the other clients receive in agreement.
    override func paste(_ sender: Any?) {
        if let plain = UIPasteboard.general.string {
            insertText(plain)
        }
    }

    // MARK: - Keyboard avoidance

    /// SwiftUI does not inset a `UIViewRepresentable` text view for the
    /// keyboard, so the view insets itself: without this the last lines of a
    /// long note sit under the keyboard while you type into them.
    private func observeKeyboard() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChange(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
    }

    @objc private func keyboardWillChange(_ notification: Notification) {
        guard
            let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
            window != nil
        else { return }

        // The notification frame is in screen coordinates, which for the app's
        // full-screen window are the window's coordinates.
        let ownFrameInWindow = convert(bounds, to: nil)
        let overlap = max(ownFrameInWindow.maxY - frame.minY, 0)
        // The safe area (tab bar, home indicator) is already avoided; only the
        // keyboard's extra reach counts.
        let bottom = max(overlap - safeAreaInsets.bottom, 0)

        guard contentInset.bottom != bottom else { return }
        let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        UIView.animate(withDuration: duration) {
            self.contentInset.bottom = bottom
            self.verticalScrollIndicatorInsets.bottom = bottom
        }
        if selectedRange.location != NSNotFound {
            scrollRangeToVisible(selectedRange)
        }
    }
}
