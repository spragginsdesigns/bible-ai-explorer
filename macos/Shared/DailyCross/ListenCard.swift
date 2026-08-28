import SwiftUI

/// "Listen" - today's "Pick Up Your Cross" as a spoken devotional.
///
/// The card body only: each shell wraps it in its own timeline stop, because
/// the macOS and iOS `TimelineStop` are private to their views and draw the
/// rail differently. Callers must check `model.phase != .hidden` first - an
/// unconfigured server (no `ELEVENLABS_API_KEY`) offers nothing here, not even
/// the rail node, and a `TimelineStop` wrapping an empty body would still draw
/// one.
///
/// Mirrors `src/components/cross/ListenCard.tsx` and
/// `mobile/src/features/cross/ListenCard.tsx`: it shimmers until the scheduled
/// generation lands, then becomes a player with a scrubber, a speed chip and a
/// "Read along" transcript. Listen is a SureWord Pro benefit, so a free account
/// gets the locked panel instead.
struct ListenCard: View {
    @Environment(\.theme) private var theme

    let model: ListenModel
    /// The speed chip's home. Persisted, so a listener who prefers 1.25x gets
    /// it on every device this account signs into a Mac from.
    @Bindable var settings: SettingsStore

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.md) {
                switch model.phase {
                case .locked: lockedPanel
                case .preparing: preparingPanel
                case .failed: failedPanel
                case .ready: player
                case .hidden: EmptyView()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task {
            model.setRate(settings.listenRate)
            model.begin()
        }
        // A rebuilt player (a new token, a new day) starts at 1x, so the stored
        // speed is re-applied whenever either side moves rather than once.
        .onChange(of: settings.listenRate) { _, next in model.setRate(next) }
    }

    // MARK: - States

    /// A locked benefit is shown, not hidden - but with NO button, because
    /// there is nowhere for one to go until billing exists.
    private var lockedPanel: some View {
        VStack(spacing: Spacing.sm) {
            Text("🔒")
                .font(.system(size: 20))
                .accessibilityHidden(true)
            Text("Listen is part of SureWord Pro")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
                .multilineTextAlignment(.center)
            Text("A spoken devotional for every day's word, ready when you wake up. Self-service SureWord Pro access isn't available yet.")
                .font(.system(size: 13.5))
                .foregroundStyle(theme.textFaint)
                .lineSpacing(4)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }

    private var preparingPanel: some View {
        VStack(spacing: Spacing.sm) {
            ShimmerBar()
            Text("Preparing your devotional…")
                .font(.system(size: 14))
                .foregroundStyle(theme.textSecondary)
            Text("This usually takes about a minute.")
                .font(.system(size: 12.5))
                .foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel("Preparing your devotional")
    }

    private var failedPanel: some View {
        VStack(spacing: Spacing.md) {
            Text(Listen.failureText)
                .font(.system(size: 14))
                .foregroundStyle(theme.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
            Button("Try again") { model.retry() }
                .buttonStyle(AccentButtonStyle())
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Player

    @ViewBuilder
    private var player: some View {
        if let title = model.audio?.title {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
        }

        HStack(spacing: Spacing.md) {
            playButton
            progressColumn
            rateChip
        }

        if let script = model.audio?.script, !script.isEmpty {
            Button {
                model.transcriptOpen.toggle()
            } label: {
                Text(model.transcriptOpen ? "Hide transcript ▴" : "Read along ▾")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.accentDim)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.transcriptOpen ? "Hide transcript" : "Read along")

            if model.transcriptOpen {
                Text(script)
                    .font(.system(size: 14.5))
                    .foregroundStyle(theme.textSecondary)
                    .lineSpacing(8)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var playButton: some View {
        Button {
            model.togglePlay()
        } label: {
            Image(systemName: model.isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(theme.accent)
                .frame(width: 48, height: 48)
                .background(theme.accentSoft, in: .circle)
                .overlay { Circle().strokeBorder(theme.accentBorder, lineWidth: 1) }
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(model.isPlaying ? "Pause devotional" : "Play devotional")
        .help(model.isPlaying ? "Pause" : "Play")
    }

    private var progressColumn: some View {
        // A duration of zero would make an empty slider range, so the track
        // always spans at least a hair and simply refuses input until the
        // player knows how long the devotional is.
        let span = max(model.duration, 0.001)
        return VStack(spacing: 6) {
            Slider(
                value: Binding(
                    get: { min(max(model.elapsed, 0), span) },
                    set: { model.scrubTarget = $0 }
                ),
                in: 0...span,
                onEditingChanged: { editing in if !editing { model.endScrub() } }
            )
            .controlSize(.small)
            .tint(theme.accent)
            .disabled(model.duration <= 0)
            .accessibilityLabel("Devotional position")
            .accessibilityValue(
                "\(Listen.formatClock(model.elapsed)) of \(Listen.formatClock(model.duration))"
            )

            HStack {
                // Real seconds at every speed - the clock reports the file, not
                // the pace.
                Text(Listen.formatClock(model.elapsed))
                Spacer()
                Text(Listen.formatClock(model.duration))
            }
            .font(.system(size: 12).monospacedDigit())
            .foregroundStyle(theme.textFaint)
        }
    }

    private var rateChip: some View {
        Button {
            settings.listenRate = Listen.nextRate(settings.listenRate)
        } label: {
            Text(Listen.formatRate(settings.listenRate))
                .font(.system(size: 13, weight: .bold).monospacedDigit())
                .foregroundStyle(theme.accent)
                .frame(width: 56, height: 36)
                .background(theme.accentSoft, in: .capsule)
                .overlay { Capsule().strokeBorder(theme.accentBorder, lineWidth: 1) }
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Playback speed \(Listen.formatRate(settings.listenRate)), press to change")
        .help("Playback speed")
    }
}

/// A slow gold pulse while the devotional is being written and narrated.
///
/// The pulse is animated on the *fill colour*, never on the view's opacity or
/// its frame: this bar is greedy (`maxWidth: .infinity`) and lives inside a
/// scroll view, and a repeating animation on a greedy shape's geometry is
/// exactly what wedged the chapter reader once already (see `macos/README.md`).
/// A colour change is pure paint and invalidates no layout.
private struct ShimmerBar: View {
    @Environment(\.theme) private var theme
    @State private var lit = false

    var body: some View {
        Capsule()
            .fill(theme.accent.opacity(lit ? 0.30 : 0.10))
            .frame(height: 12)
            .frame(maxWidth: .infinity)
            .overlay { Capsule().strokeBorder(theme.accentBorder, lineWidth: 1) }
            .animation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: lit)
            .onAppear { lit = true }
            .accessibilityHidden(true)
    }
}
