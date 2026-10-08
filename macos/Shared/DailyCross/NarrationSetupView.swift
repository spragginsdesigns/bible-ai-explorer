import AVFoundation
import SwiftUI

/// State for the narrator setup panel: the voice catalog, the selection, and a
/// voice preview on its own player (never the devotional's).
///
/// A port of the state half of `mobile/src/features/cross/NarrationSetup.tsx`.
@MainActor
@Observable
final class NarrationSetupModel {
    /// Android's exact copy.
    static let voicesFailedText = "Voices couldn't load. You can use the default narrator or try again."
    static let previewFailedText = "This preview couldn't play. Try another voice."
    /// A preview that has not started playing this long after the tap is dead.
    static let previewStall: Duration = .seconds(10)

    private(set) var catalog: NarrationVoices?
    var selection = NarrationSelection.initial
    var expanded = false
    /// One message slot, as on Android: a failed catalog or a dead preview.
    private(set) var error: String?
    /// The voice whose preview is playing (or loading), if any.
    private(set) var previewId: String?

    private let loadVoices: @Sendable () async throws -> NarrationVoices
    private let preferences: NarrationPreferences
    private var previewPlayer: AVPlayer?
    private var previewStatus: NSKeyValueObservation?
    private var previewEnd: (any NSObjectProtocol)?
    private var previewStallTask: Task<Void, Never>?

    init(
        loadVoices: @escaping @Sendable () async throws -> NarrationVoices,
        preferences: NarrationPreferences = NarrationPreferences()
    ) {
        self.loadVoices = loadVoices
        self.preferences = preferences
    }

    var selectedVoice: NarrationVoice? {
        catalog?.voices.first { $0.id == selection.voiceId }
    }

    /// Load the catalog and restore the saved choice against it. A failure
    /// keeps the defaults (no voice, natural), exactly as Android's
    /// `Promise.all` does, and the request then goes out without a voice.
    func load() async {
        error = nil
        do {
            let next = try await loadVoices()
            guard !Task.isCancelled else { return }
            catalog = next
            selection = NarrationSelection.restore(saved: preferences.load(), catalog: next)
        } catch {
            guard !Task.isCancelled else { return }
            self.error = Self.voicesFailedText
        }
    }

    func select(_ voice: NarrationVoice) {
        stopPreview()
        selection.voiceId = voice.id
    }

    /// Play a voice's sample, or stop it if it is the one already playing.
    func togglePreview(_ voice: NarrationVoice) {
        let wasPlaying = previewId == voice.id
        stopPreview()
        guard !wasPlaying, let raw = voice.previewUrl, let url = URL(string: raw) else { return }
        previewId = voice.id
        activatePlaybackSession()

        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        previewPlayer = player
        previewStatus = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            let playing = player.timeControlStatus == .playing
            Task { @MainActor [weak self] in
                if playing { self?.previewStallTask?.cancel() }
            }
        }
        previewEnd = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.stopPreview() }
        }
        let id = voice.id
        previewStallTask = Task { [weak self] in
            try? await Task.sleep(for: Self.previewStall)
            guard !Task.isCancelled, let self, self.previewId == id else { return }
            self.stopPreview()
            self.error = Self.previewFailedText
        }
        player.play()
    }

    func stopPreview() {
        previewStallTask?.cancel()
        previewStallTask = nil
        previewStatus = nil
        if let previewEnd { NotificationCenter.default.removeObserver(previewEnd) }
        previewEnd = nil
        previewPlayer?.pause()
        previewPlayer = nil
        previewId = nil
    }

    /// The options to send, saved first so the next day opens on this choice.
    func commit() -> NarrationOptions {
        stopPreview()
        let options = NarrationOptions.request(voiceId: selection.voiceId, style: selection.style)
        preferences.save(options)
        return options
    }

    isolated deinit {
        previewStallTask?.cancel()
        if let previewEnd { NotificationCenter.default.removeObserver(previewEnd) }
        previewPlayer?.pause()
    }

    private func activatePlaybackSession() {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio)
        try? session.setActive(true)
        #endif
    }
}

/// "Let today's word meet you in audio": narrator, delivery, and the explicit
/// "Generate audio narrative" request. Shown for the idle card and under the
/// failure text on the failed card, as on Android.
///
/// A port of `mobile/src/features/cross/NarrationSetup.tsx`; every string is
/// Android's.
struct NarrationSetupView: View {
    @Environment(\.theme) private var theme
    @State private var model: NarrationSetupModel
    @State private var attempt = 0
    let onGenerate: (NarrationOptions) -> Void

    init(
        loadVoices: @escaping @Sendable () async throws -> NarrationVoices,
        onGenerate: @escaping (NarrationOptions) -> Void
    ) {
        _model = State(initialValue: NarrationSetupModel(loadVoices: loadVoices))
        self.onGenerate = onGenerate
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            heading
            narratorPicker
            delivery
            if let error = model.error {
                VStack(alignment: .leading, spacing: 0) {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundStyle(theme.textSecondary)
                        .lineSpacing(4)
                        .accessibilityAddTraits(.updatesFrequently)
                    Button("Reload voices") { attempt += 1 }
                        .buttonStyle(.plain)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(theme.accent)
                        .frame(minHeight: 48)
                }
            }
            Button {
                onGenerate(model.commit())
            } label: {
                Text("Generate audio narrative")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255))
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(theme.accent, in: .rect(cornerRadius: Radius.lg))
                    .contentShape(.rect(cornerRadius: Radius.lg))
            }
            .buttonStyle(.plain)
            Text("Made only on your request. Today's audio is saved, so you can return and listen again.")
                .font(.system(size: 12))
                .foregroundStyle(theme.textSecondary)
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: attempt) { await model.load() }
        .onDisappear { model.stopPreview() }
    }

    private var heading: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Image(systemName: "headphones")
                .font(.system(size: 22))
                .foregroundStyle(theme.accent)
                .padding(.top, 4)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Let today's word meet you in audio")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(theme.text)
                Text("Your verse, reflection, study path and prayer, narrated when you choose.")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.textSecondary)
                    .lineSpacing(4)
            }
        }
    }

    private var narratorPicker: some View {
        let name = model.selectedVoice?.name ?? "Default narrator"
        return VStack(alignment: .leading, spacing: Spacing.sm) {
            Button {
                model.expanded.toggle()
            } label: {
                HStack(spacing: Spacing.sm) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Narrator")
                            .font(.system(size: 12))
                            .foregroundStyle(theme.textSecondary)
                        Text(name)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(theme.text)
                    }
                    Spacer()
                    Image(systemName: model.expanded ? "chevron.up" : "chevron.down")
                        .foregroundStyle(theme.textSecondary)
                }
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                .contentShape(.rect(cornerRadius: Radius.lg))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Narrator: \(name)")
            .accessibilityValue(model.expanded ? "Expanded" : "Collapsed")

            if model.expanded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if model.catalog == nil, model.error == nil {
                            Text("Loading voices…")
                                .font(.system(size: 14))
                                .foregroundStyle(theme.textSecondary)
                                .padding(Spacing.md)
                        }
                        ForEach(model.catalog?.voices ?? []) { voice in
                            voiceRow(voice)
                            Divider().overlay(theme.borderStrong)
                        }
                    }
                }
                .frame(maxHeight: 280)
                .fixedSize(horizontal: false, vertical: true)
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                .clipShape(.rect(cornerRadius: Radius.lg))
            }
        }
    }

    private func voiceRow(_ voice: NarrationVoice) -> some View {
        let selected = model.selection.voiceId == voice.id
        let previewing = model.previewId == voice.id
        return HStack(spacing: 0) {
            Button {
                model.select(voice)
            } label: {
                HStack(spacing: Spacing.sm) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(voice.name)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(theme.text)
                        Text(voice.description)
                            .font(.system(size: 12))
                            .foregroundStyle(theme.textSecondary)
                    }
                    Spacer()
                    if selected {
                        Image(systemName: "checkmark").foregroundStyle(theme.accent)
                    }
                }
                .padding(Spacing.md)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(voice.name), \(voice.description)")
            .accessibilityAddTraits(selected ? .isSelected : [])

            if voice.previewUrl != nil {
                Button {
                    model.togglePreview(voice)
                } label: {
                    Image(systemName: previewing ? "pause.fill" : "play.fill")
                        .foregroundStyle(theme.accent)
                        .frame(width: 48, height: 48)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(previewing ? "Stop" : "Preview") \(voice.name)")
            }
        }
    }

    private var delivery: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Delivery")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.text)
            HStack(spacing: Spacing.sm) {
                ForEach(NarrationStyle.allCases) { style in
                    let selected = model.selection.style == style
                    Button {
                        model.selection.style = style
                    } label: {
                        Text(style.label)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(selected ? theme.accent : theme.text)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(selected ? theme.accentSoft : .clear, in: .rect(cornerRadius: Radius.lg))
                            .overlay {
                                RoundedRectangle(cornerRadius: Radius.lg)
                                    .strokeBorder(selected ? theme.accent : theme.borderStrong, lineWidth: 1)
                            }
                            .contentShape(.rect(cornerRadius: Radius.lg))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            Text(model.selection.style.description)
                .font(.system(size: 12))
                .foregroundStyle(theme.textSecondary)
        }
    }
}
