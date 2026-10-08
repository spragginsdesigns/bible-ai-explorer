import Foundation
import Testing

@testable import SureWord

/// Pins the on-demand Listen contract the iOS client shares with Android
/// 1.78.0+ (`mobile/src/features/cross/{listen,narrationOptions}.ts`,
/// `NarrationSetup.tsx`, `ListenCard.tsx`) and the server's
/// `POST /api/verse-of-day/audio { voiceId?, style? }`.

private func audio(_ status: DailyCrossAudioStatus, url: String? = nil) -> DailyCrossAudio {
    DailyCrossAudio(status: status, url: url, plan: .pro)
}

private func json(_ value: some Encodable) throws -> [String: String] {
    let data = try JSONEncoder().encode(value)
    return try JSONDecoder().decode([String: String].self, from: data)
}

@Suite("Narration options")
struct NarrationOptionsTests {
    @Test("An empty choice posts an empty object, which the server reads as its defaults")
    func emptyEncodesAsEmptyObject() throws {
        #expect(try json(NarrationOptions()) == [:])
    }

    @Test("A full choice posts exactly voiceId and style")
    func fullChoiceEncodes() throws {
        let options = NarrationOptions(voiceId: "UgBBYS2sOqTuMpoF3BR0", style: .calm)
        #expect(try json(options) == ["voiceId": "UgBBYS2sOqTuMpoF3BR0", "style": "calm"])
    }

    @Test("The setup panel drops an empty voice but always sends the delivery")
    func requestFromPanel() throws {
        #expect(try json(NarrationOptions.request(voiceId: "", style: .natural)) == ["style": "natural"])
        #expect(
            try json(NarrationOptions.request(voiceId: "v1", style: .expressive))
                == ["voiceId": "v1", "style": "expressive"]
        )
    }

    @Test("Delivery choices, labels and descriptions match Android, in order")
    func styleCatalog() {
        #expect(NarrationStyle.allCases.map(\.rawValue) == ["calm", "natural", "expressive"])
        #expect(NarrationStyle.allCases.map(\.label) == ["Calm", "Natural", "Expressive"])
        #expect(
            NarrationStyle.allCases.map(\.description)
                == ["Steady and reflective", "Warm and conversational", "More feeling and emphasis"]
        )
        #expect(NarrationStyle.defaultStyle == .natural)
    }

    @Test("A stored style this build does not offer keeps the saved voice")
    func lenientStoredStyle() throws {
        let decoded = try JSONDecoder().decode(
            NarrationOptions.self,
            from: Data(#"{"voiceId":"v2","style":"whisper"}"#.utf8)
        )
        #expect(decoded == NarrationOptions(voiceId: "v2", style: nil))
    }
}

@Suite("Narration restore")
struct NarrationRestoreTests {
    private let catalog = NarrationVoices(
        voices: [
            NarrationVoice(id: "default", name: "Mark", description: "American · male"),
            NarrationVoice(id: "v2", name: "Grace", description: "British · female"),
        ],
        defaultVoiceId: "default"
    )

    @Test("A saved voice the catalog still offers is restored, with its delivery")
    func restoresOffered() {
        let selection = NarrationSelection.restore(
            saved: NarrationOptions(voiceId: "v2", style: .expressive),
            catalog: catalog
        )
        #expect(selection == NarrationSelection(voiceId: "v2", style: .expressive))
    }

    @Test("A saved voice the catalog no longer offers falls back to the default")
    func fallsBackToDefault() {
        let selection = NarrationSelection.restore(
            saved: NarrationOptions(voiceId: "retired", style: .calm),
            catalog: catalog
        )
        #expect(selection == NarrationSelection(voiceId: "default", style: .calm))
    }

    @Test("Nothing saved opens on the default narrator, natural delivery")
    func nothingSaved() {
        #expect(
            NarrationSelection.restore(saved: nil, catalog: catalog)
                == NarrationSelection(voiceId: "default", style: .natural)
        )
    }

    @Test("The choice round-trips through the shared key")
    func persists() throws {
        let suite = "NarrationRestoreTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = NarrationPreferences(defaults: defaults)
        #expect(preferences.load() == nil)
        preferences.save(NarrationOptions(voiceId: "v2", style: .calm))
        #expect(NarrationPreferences.key == "sureword.narrationOptions")
        #expect(preferences.load() == NarrationOptions(voiceId: "v2", style: .calm))
    }
}

@Suite("Narration voices decoding")
struct NarrationVoicesDecodingTests {
    @Test("Decodes the catalog, including a voice with no preview")
    func decodesCatalog() throws {
        let decoded = try JSONDecoder().decode(
            NarrationVoices.self,
            from: Data(
                """
                {
                  "voices": [
                    {"id": "a", "name": "Mark", "description": "American · male", "previewUrl": "https://storage.example/a.mp3"},
                    {"id": "b", "name": "Grace", "description": "British · female", "previewUrl": null}
                  ],
                  "defaultVoiceId": "a"
                }
                """.utf8
            )
        )
        #expect(decoded.defaultVoiceId == "a")
        #expect(decoded.voices.map(\.id) == ["a", "b"])
        #expect(decoded.voices[0].previewUrl == "https://storage.example/a.mp3")
        #expect(decoded.voices[1].previewUrl == nil)
    }

    @Test("A locked account's empty catalog decodes")
    func decodesEmpty() throws {
        let decoded = try JSONDecoder().decode(
            NarrationVoices.self,
            from: Data(#"{"voices":[],"defaultVoiceId":""}"#.utf8)
        )
        #expect(decoded.voices.isEmpty)
        #expect(decoded.defaultVoiceId.isEmpty)
    }
}

@Suite("Listen phase (iOS)")
struct ListenPhaseIOSTests {
    @Test("Maps every server status the way Android's listenPhase does")
    func phaseMapping() {
        #expect(Listen.phase(nil) == .loading)
        #expect(Listen.phase(audio(.none)) == .idle)
        #expect(Listen.phase(audio(.pending)) == .preparing)
        #expect(Listen.phase(audio(.ready, url: "https://blob/x.mp3")) == .ready)
        #expect(Listen.phase(audio(.ready)) == .failed)
        #expect(Listen.phase(audio(.failed)) == .failed)
        #expect(Listen.phase(audio(.unavailable)) == .hidden)
        #expect(Listen.phase(audio(.locked)) == .locked)
        #expect(Listen.phase(audio(.unrecognized)) == .failed)
    }

    @Test("Only a pending generation is polled")
    func pollsOnlyPending() {
        #expect(Listen.shouldPoll(.preparing))
        for phase in [ListenPhase.hidden, .locked, .loading, .idle, .ready, .failed] {
            #expect(!Listen.shouldPoll(phase))
        }
    }
}

/// Counts and scripts the network so the model can be driven without a server.
private actor FakeListenServer {
    var stateCalls = 0
    var generateBodies: [NarrationOptions] = []
    var stateResult: Result<DailyCrossAudio, any Error>
    var generateResult: Result<DailyCrossAudio, any Error>

    init(
        state: Result<DailyCrossAudio, any Error> = .success(audio(.none)),
        generate: Result<DailyCrossAudio, any Error> = .success(audio(.failed))
    ) {
        stateResult = state
        generateResult = generate
    }

    func state() throws -> DailyCrossAudio {
        stateCalls += 1
        return try stateResult.get()
    }

    func generate(_ options: NarrationOptions) throws -> DailyCrossAudio {
        generateBodies.append(options)
        return try generateResult.get()
    }

    func setState(_ result: Result<DailyCrossAudio, any Error>) { stateResult = result }

    nonisolated var transport: ListenTransport {
        ListenTransport(
            state: { try await self.state() },
            generate: { try await self.generate($0) },
            voices: { NarrationVoices(voices: [], defaultVoiceId: "") }
        )
    }
}

private struct Offline: Error {}

@MainActor
@Suite("Listen model")
struct ListenModelTests {
    private func model(_ server: FakeListenServer) -> ListenModel {
        ListenModel(transport: server.transport, token: { _ in nil })
    }

    @Test("Opening reads status once and offers the setup panel, without polling")
    func openingIsIdle() async {
        let server = FakeListenServer()
        let listen = model(server)
        #expect(listen.phase == .loading)
        await listen.begin()?.value
        #expect(listen.phase == .idle)
        #expect(await server.stateCalls == 1)
    }

    @Test("begin() reads again once the previous read has finished")
    func beginReruns() async {
        let server = FakeListenServer()
        let listen = model(server)
        await listen.begin()?.value
        await listen.begin()?.value
        #expect(await server.stateCalls == 2)
    }

    @Test("begin() coalesces while a read is in flight")
    func beginCoalesces() async {
        let server = FakeListenServer()
        let listen = model(server)
        let first = listen.begin()
        let second = listen.begin()
        await first?.value
        await second?.value
        #expect(await server.stateCalls == 1)
    }

    @Test("A failed opening read is Android's load failure, not a shimmer")
    func openingFailure() async {
        let server = FakeListenServer(state: .failure(Offline()))
        let listen = model(server)
        await listen.begin()?.value
        #expect(listen.phase == .failed)
        #expect(listen.failureText == "Couldn't load audio. Try again.")
    }

    @Test("Generate posts the chosen options, and a failed generation says so")
    func generatePostsOptions() async {
        let server = FakeListenServer()
        let listen = model(server)
        await listen.begin()?.value
        let options = NarrationOptions(voiceId: "v2", style: .calm)
        let request = listen.generate(options)
        #expect(listen.phase == .preparing)
        await request?.value
        #expect(await server.generateBodies == [options])
        #expect(listen.phase == .failed)
        #expect(listen.failureText == "Couldn't prepare audio - try again")
    }

    @Test("A request that errors falls back to one status read")
    func generateErrorFallsBack() async {
        let server = FakeListenServer(generate: .failure(Offline()))
        let listen = model(server)
        await listen.begin()?.value
        await listen.generate(NarrationOptions(style: .natural))?.value
        // The follow-up read answered "none", which is neither pending nor ready.
        #expect(listen.failureText == "Couldn't prepare audio. Try again.")
        #expect(listen.phase == .failed)
    }

    @Test("reset() returns the card to loading and lets begin() read again")
    func resetRebegins() async {
        let server = FakeListenServer()
        let listen = model(server)
        await listen.begin()?.value
        listen.reset()
        #expect(listen.phase == .loading)
        await listen.begin()?.value
        #expect(await server.stateCalls == 2)
    }
}

@Suite("Daily Cross identity")
struct DailyCrossIdentityTests {
    @Test("A day is its stored row, or its reference on an older server")
    func identity() {
        let stored = DailyCrossEntry(id: "row-1", reference: "John 3:16", book: "John", chapter: 3, verse: 16, text: "", reason: "")
        let legacy = DailyCrossEntry(reference: "John 3:16", book: "John", chapter: 3, verse: 16, text: "", reason: "")
        #expect(DailyCrossModel.identity(stored) == "row-1")
        #expect(DailyCrossModel.identity(legacy) == "John 3:16")
    }
}
