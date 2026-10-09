import SwiftUI

@MainActor
private enum LaunchSplashSession {
    static var started = false
    static let artwork: Image? = {
        guard let url = Bundle.main.url(forResource: "sureword-dawn", withExtension: "jpg"),
              let data = try? Data(contentsOf: url) else { return nil }
        #if os(macOS)
        guard let image = NSImage(data: data) else { return nil }
        return Image(nsImage: image)
        #else
        guard let image = UIImage(data: data) else { return nil }
        return Image(uiImage: image)
        #endif
    }()
}

private struct LaunchSplashModifier: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var showing = !LaunchSplashSession.started
    @State private var backgrounded = false
    @State private var generation = 0

    func body(content: Content) -> some View {
        content
            .overlay {
                if showing && !reduceMotion && !voiceOver {
                    DawnLaunchSplash { showing = false }
                        .id(generation)
                        .transition(.opacity)
                        .zIndex(1_000)
                }
            }
            .onAppear { LaunchSplashSession.started = true }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { backgrounded = true; showing = false }
                if phase == .active && backgrounded {
                    backgrounded = false
                    generation += 1
                    showing = true
                }
            }
    }
}

private struct DawnLaunchSplash: View {
    let finish: () -> Void
    @State private var revealed = false
    @State private var opacity = 1.0

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(red: 6 / 255, green: 20 / 255, blue: 27 / 255)
                if let image = LaunchSplashSession.artwork { artwork(image, size: geometry.size) }
                LinearGradient(colors: [.black.opacity(0.45), .clear, .black.opacity(0.75)],
                               startPoint: .top, endPoint: .bottom)
                Color(red: 6 / 255, green: 20 / 255, blue: 27 / 255)
                    .opacity(revealed ? 0 : 0.5)
                VStack {
                    Spacer().frame(height: geometry.size.height * 0.15)
                    Text("SureWord")
                        .font(.custom(FontFamily.brand, size: min(72, geometry.size.width * 0.15)))
                    Spacer()
                    VStack(spacing: 10) {
                        Text("Your walk with God.").font(.title2)
                        Text("One step at a time.").font(.body)
                            .foregroundStyle(Color(red: 239 / 255, green: 222 / 255, blue: 192 / 255))
                    }
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    Spacer().frame(height: geometry.size.height * 0.16)
                }
                .foregroundStyle(Color(red: 1, green: 248 / 255, blue: 232 / 255))
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
            .opacity(opacity)
            .contentShape(Rectangle())
            .onTapGesture { finish() }
            .accessibilityHidden(true)
            .task {
                withAnimation(.easeOut(duration: 1.65)) { revealed = true }
                do {
                    try await Task.sleep(for: .milliseconds(1_650))
                    withAnimation(.easeOut(duration: 0.22)) { opacity = 0 }
                    try await Task.sleep(for: .milliseconds(220))
                    finish()
                } catch { /* Background/unmount cancels this generation. */ }
            }
        }
        .ignoresSafeArea()
    }

    private func artwork(_ image: Image, size: CGSize) -> some View {
        image.resizable().scaledToFill()
            .frame(width: size.width, height: size.height)
            .scaleEffect(revealed ? 1 : 1.035)
    }
}

extension View {
    func sureWordLaunchSplash() -> some View { modifier(LaunchSplashModifier()) }
}
