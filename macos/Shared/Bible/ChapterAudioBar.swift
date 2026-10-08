import SwiftUI

struct ChapterAudioBar: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    var model: ChapterAudioModel { app.chapterAudio }

    var body: some View {
        if model.isOpen {
            VStack(spacing: 6) {
                HStack {
                    Text(model.reference + (model.verse.map { " · \($0)" } ?? "")).font(.headline)
                    Spacer()
                    Button("Close narration", systemImage: "xmark", action: model.close).labelStyle(.iconOnly)
                }
                if let error = model.error { Text(error).foregroundStyle(theme.danger).font(.callout) }
                if model.stillListening {
                    HStack { Text("Still listening?"); Spacer(); Button("Keep listening", action: model.keepListening) }
                } else {
                    HStack {
                        Button("Previous verse", systemImage: "backward.end.fill") { model.skipVerse(-1) }.labelStyle(.iconOnly)
                        Button(model.isPlaying ? "Pause narration" : "Play narration", systemImage: model.isPlaying ? "pause.fill" : "play.fill", action: model.toggle).labelStyle(.iconOnly)
                        Button("Next verse", systemImage: "forward.end.fill") { model.skipVerse(1) }.labelStyle(.iconOnly)
                        Text(model.isReady ? Listen.formatClock(model.elapsed) : "Loading…").monospacedDigit().font(.caption)
                        Spacer()
                        Button(Listen.formatRate(app.settings.listenRate), action: model.cycleRate).accessibilityLabel("Playback speed")
                    }.disabled(!model.isReady)
                    Slider(value: Binding(get: { model.elapsed }, set: { model.seek(to: $0) }), in: 0...max(1, model.duration))
                        .disabled(!model.isReady).accessibilityLabel("Narration progress")
                }
            }
            .buttonStyle(NarrationControlStyle())
            .padding(12)
            .foregroundStyle(theme.text)
            .background(theme.surface)
        }
    }
}

private struct NarrationControlStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}
