import SwiftUI

/// The spotlight ("glow") for Walk with me (docs/onboarding/PLAN.md, "The
/// spotlight"): a named place lit with a gold ring over a dimmed screen, and
/// SureWord's sentence beside it.
///
/// Places are named, not positioned. A view joins the registry with
/// `.spotlightTarget(.todayCross)`, which publishes its bounds as an anchor
/// under that `AppTarget`; a screen root carries `.spotlightHost()`, which
/// resolves the anchor for the current request and draws the overlay. Hosts
/// sit on each screen root rather than once at the app root because anchor
/// preferences do not cross the tab, split-view and navigation containers.
/// A place nobody registers is simply never drawn, and the model's timeout
/// moves on (`OnboardingModel.light`).
struct SpotlightAnchorKey: PreferenceKey {
    static let defaultValue: [AppTarget: Anchor<CGRect>] = [:]

    static func reduce(value: inout [AppTarget: Anchor<CGRect>], nextValue: () -> [AppTarget: Anchor<CGRect>]) {
        value.merge(nextValue()) { _, new in new }
    }
}

extension View {
    /// Register this view as `target` for the spotlight. `isActive` lets a
    /// list register only one of its rows (the reader's lit verse).
    func spotlightTarget(_ target: AppTarget, isActive: Bool = true) -> some View {
        anchorPreference(key: SpotlightAnchorKey.self, value: .bounds) { anchor in
            isActive ? [target: anchor] : [:]
        }
    }

    /// Draw the spotlight over this screen when its place is registered below.
    func spotlightHost() -> some View {
        modifier(SpotlightHost())
    }

    /// For a scroll view holding lit places (each also `.id(target)`): scroll
    /// the requested one into view, since it may be below the fold.
    func spotlightScroll(to targets: Set<AppTarget>) -> some View {
        modifier(SpotlightScroll(targets: targets))
    }
}

private struct SpotlightScroll: ViewModifier {
    @Environment(AppModel.self) private var app
    let targets: Set<AppTarget>

    func body(content: Content) -> some View {
        ScrollViewReader { proxy in
            content.onChange(of: app.onboarding.spotlight?.id, initial: true) { _, _ in
                guard let target = app.onboarding.spotlight?.target, targets.contains(target) else { return }
                withAnimation { proxy.scrollTo(target, anchor: .center) }
            }
        }
    }
}

private struct SpotlightHost: ViewModifier {
    @Environment(AppModel.self) private var app

    func body(content: Content) -> some View {
        content.overlayPreferenceValue(SpotlightAnchorKey.self) { anchors in
            if let request = app.onboarding.spotlight, let anchor = anchors[request.target] {
                GeometryReader { proxy in
                    SpotlightOverlay(
                        request: request,
                        frame: proxy[anchor],
                        container: proxy.size,
                        onNext: { app.onboarding.advanceSpotlight(app: app) },
                        onClose: { app.onboarding.closeSpotlight() }
                    )
                }
                .onAppear { app.onboarding.spotlightAppeared(request.id) }
                .onChange(of: request.id) { _, id in app.onboarding.spotlightAppeared(id) }
            }
        }
        // The innermost host draws; a host further out (the Mac's detail
        // column around the reader) must not draw the same place again.
        .transformPreference(SpotlightAnchorKey.self) { $0 = [:] }
    }
}

/// The dim, the ring and the caption. Only the caption takes touches, so the
/// lit control underneath still works (tapping the lit verse explains it).
private struct SpotlightOverlay: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.textScaleFactor) private var textScale
    let request: SpotlightRequest
    let frame: CGRect
    let container: CGSize
    let onNext: () -> Void
    let onClose: () -> Void

    @State private var pulsing = false

    /// A little outside the place, except for a whole screen (a tab stop),
    /// where outside would be off the edge.
    private var ring: CGRect {
        let wholeScreen = frame.width >= container.width * 0.9 && frame.height >= container.height * 0.8
        return wholeScreen ? frame.insetBy(dx: 4, dy: 4) : frame.insetBy(dx: -6, dy: -6)
    }

    /// Below the place when there is room, above it otherwise.
    private var captionBelow: Bool { ring.maxY + 160 < container.height || ring.minY < 160 }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(Color.black.opacity(0.45))
                .reverseMask {
                    RoundedRectangle(cornerRadius: Radius.md)
                        .frame(width: ring.width, height: ring.height)
                        .position(x: ring.midX, y: ring.midY)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)

            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.accent, lineWidth: 3)
                .frame(width: ring.width, height: ring.height)
                .scaleEffect(pulsing ? 1.03 : 1)
                .opacity(pulsing ? 0.7 : 1)
                .position(x: ring.midX, y: ring.midY)
                .allowsHitTesting(false)
                .accessibilityHidden(true)

            caption
                .frame(maxWidth: min(container.width - Spacing.lg * 2, 420))
                .frame(maxWidth: .infinity)
                .padding(.horizontal, Spacing.lg)
                .offset(y: captionBelow ? min(ring.maxY + Spacing.md, container.height - 150) : max(ring.minY - 150, Spacing.md))
        }
        .frame(width: container.width, height: container.height, alignment: .topLeading)
        .onAppear { startPulse() }
        .onChange(of: request.id) { _, _ in startPulse() }
    }

    private func startPulse() {
        // Reduce Motion gets a steady ring.
        guard !reduceMotion else { pulsing = false; return }
        pulsing = false
        withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulsing = true }
    }

    private var caption: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(request.caption)
                .appFont(.system(size: 16))
                .foregroundStyle(theme.text)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                if let stop = request.stop, let count = request.stopCount {
                    Text("\(stop + 1) of \(count)")
                        .appFont(.system(size: 13))
                        .foregroundStyle(theme.textMuted)
                }
                Spacer(minLength: Spacing.md)
                if request.stop != nil, !request.isLastStop {
                    Button("Stop", action: onClose)
                        .buttonStyle(SubtleButtonStyle())
                        .appFont(.system(size: 15))
                        .foregroundStyle(theme.textSecondary)
                }
                Button(request.isLastStop ? "Done" : "Next", action: onNext)
                    .buttonStyle(AccentButtonStyle())
                    .appFont(.system(size: 15, weight: .semibold))
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(Spacing.lg)
        .background(theme.bgElevated, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.accentBorder, lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.3), radius: 12, y: 4)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }
}

private extension View {
    /// Cut `mask` out of this view: the hole the lit place shows through.
    func reverseMask<Mask: View>(@ViewBuilder _ mask: () -> Mask) -> some View {
        self.mask {
            Rectangle()
                .overlay(alignment: .topLeading) {
                    mask().blendMode(.destinationOut)
                }
                .compositingGroup()
        }
    }
}
