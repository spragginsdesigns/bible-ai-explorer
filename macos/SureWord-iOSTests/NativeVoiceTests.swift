import Foundation
import Testing
@testable import SureWord

@Suite("Native voice controls")
struct NativeVoiceTests {
    let options = ["I have been saved", "I am not sure", "I have not been saved", "Skip for now"]

    @Test("Full labels and single numbered choices select exactly one visible option")
    func choices() {
        #expect(NativeVoiceRules.resolve("I HAVE BEEN SAVED!", options: options) == .choose(options[0]))
        #expect(NativeVoiceRules.resolve("Please choose option number three please", options: options) == .choose(options[2]))
        #expect(NativeVoiceRules.resolve("the second option", options: options) == .choose(options[1]))
        #expect(NativeVoiceRules.resolve("select 4", options: options) == .choose(options[3]))
        #expect(NativeVoiceRules.resolve("select the fourth option", options: options) == .choose(options[3]))
        #expect(NativeVoiceRules.resolve("the fourth one", options: options) == .choose(options[3]))
        #expect(NativeVoiceRules.resolve("choose I am not sure", options: options) == .choose(options[1]))
        #expect(NativeVoiceRules.resolve("I am saved and growing in the Word", options: ["Saved and growing in the Word"]) == .choose("Saved and growing in the Word"))
        let hours = OnboardingRules.pickableHours.map(OnboardingRules.hourLabel) + ["Skip for now"]
        #expect(hours.count == 25)
        #expect(NativeVoiceRules.resolve("option twenty one", options: hours) == .choose(hours[20]))
        #expect(NativeVoiceRules.resolve("the twenty first option", options: hours) == .choose(hours[20]))
        #expect(NativeVoiceRules.resolve("the fourth one", options: hours) == .choose(hours[3]))
        #expect(NativeVoiceRules.resolve("the twenty fourth option", options: hours) == .choose(hours[23]))
        #expect(NativeVoiceRules.resolve("option twenty five", options: hours) == .choose("Skip for now"))
    }

    @Test("Partial, duplicate, conflicting and out-of-range choices never select")
    func noGuessing() {
        #expect(NativeVoiceRules.resolve("saved", options: options) == .ambiguous)
        #expect(NativeVoiceRules.resolve("choose option 1 or option 3", options: options) == .ambiguous)
        #expect(NativeVoiceRules.resolve("option 99", options: options) == .ambiguous)
        #expect(NativeVoiceRules.resolve("-1", options: options) == .ambiguous)
        #expect(NativeVoiceRules.resolve("one", options: ["One", "One"]) == .ambiguous)
        #expect(NativeVoiceRules.resolve("What does salvation mean?", options: options) == .unmatched)
        #expect(NativeVoiceRules.resolve("", options: options) == .unmatched)
    }

    @Test("Explicit app navigation does not steal Bible questions")
    func navigation() {
        for destination in NativeVoiceRules.destinations {
            #expect(NativeVoiceRules.resolve("open \(destination)", options: []) == .navigate(destination))
            #expect(NativeVoiceRules.resolve("go to \(destination)", options: []) == .navigate(destination))
        }
        #expect(NativeVoiceRules.resolve("What does the Bible say about prayer?", options: []) == .unmatched)
        #expect(NativeVoiceRules.resolve("go back", options: []) == .back)
        #expect(NativeVoiceRules.resolve("read my options", options: options) == .repeatOptions)
        #expect(NativeVoiceRules.resolve("repeat that", options: []) == .repeatOptions)
        #expect(NativeVoiceRules.resolve("stop listening", options: options) == .stop)
        #expect(NativeVoiceRules.resolve("repeat options", options: options) == .repeatOptions)
        #expect(NativeVoiceRules.resolve("stop voice controls", options: options) == .stop)
        #expect(NativeVoiceRules.resolve("stop voice control", options: []) == .stop)
        #expect(NativeVoiceRules.resolve("end voice controls", options: []) == .stop)
    }

    @Test("Voice uses the visible tour buttons and can open the time picker without submitting it")
    func visibleActions() {
        let first = SpotlightRequest(target: .tabToday, caption: "Today", stop: 0, stopCount: 3)
        let last = SpotlightRequest(target: .tabBible, caption: "Bible", stop: 2, stopCount: 3)
        #expect(NativeVoiceRules.spotlightOptions(first) == ["Next", "Stop"])
        #expect(NativeVoiceRules.spotlightOptions(last) == ["Done", "Stop"])
        #expect(NativeVoiceRules.resolve("Next", options: NativeVoiceRules.spotlightOptions(first)) == .choose("Next"))
        #expect(NativeVoiceRules.resolve("Stop", options: NativeVoiceRules.spotlightOptions(first)) == .choose("Stop"))
        #expect(NativeVoiceRules.resolve("stop voice controls", options: NativeVoiceRules.spotlightOptions(first)) == .stop)
        #expect(NativeVoiceRules.resolve("Pick a time", options: ["Pick a time", "Skip for now"]) == .choose("Pick a time"))
    }

    @Test("Every playback, network, foreground and save barrier must settle before capture")
    func captureBarriers() {
        #expect(NativeVoiceRules.canListen(enabled: true, foreground: true, busy: false, narrating: false, saved: true))
        #expect(!NativeVoiceRules.canListen(enabled: false, foreground: true, busy: false, narrating: false, saved: true))
        #expect(!NativeVoiceRules.canListen(enabled: true, foreground: false, busy: false, narrating: false, saved: true))
        #expect(!NativeVoiceRules.canListen(enabled: true, foreground: true, busy: true, narrating: false, saved: true))
        #expect(!NativeVoiceRules.canListen(enabled: true, foreground: true, busy: false, narrating: true, saved: true))
        #expect(!NativeVoiceRules.canListen(enabled: true, foreground: true, busy: false, narrating: false, saved: false))
    }

    @Test("Owner-only server authorization requires 200 and Pro; relay availability is independent")
    func ownerGate() {
        #expect(NativeVoiceRules.ownerIdentity(account: "owner", profileID: "owner", email: "atmosphere9999@gmail.com", verified: true))
        #expect(!NativeVoiceRules.ownerIdentity(account: "owner", profileID: "other", email: "atmosphere9999@gmail.com", verified: true))
        #expect(!NativeVoiceRules.ownerIdentity(account: "owner", profileID: "owner", email: "other@gmail.com", verified: true))
        #expect(!NativeVoiceRules.ownerIdentity(account: "owner", profileID: "owner", email: "atmosphere9999@gmail.com", verified: false))
        let owner: JSONValue = .object(["pro": .bool(true), "available": .bool(false)])
        #expect(NativeVoiceRules.authorized(status: 200, value: owner))
        #expect(!NativeVoiceRules.authorized(status: 403, value: owner))
        #expect(!NativeVoiceRules.authorized(status: 500, value: owner))
        #expect(!NativeVoiceRules.authorized(status: 200, value: .object(["pro": .bool(false)])))
        #expect(!NativeVoiceRules.authorized(status: 200, value: nil))
    }

    @Test("An identical older reply does not unlock capture before the new answer is saved")
    func persistedIdentity() throws {
        let message = ChatViewMessage(id: "new-answer", role: .assistant, content: "Your answer")
        func row(_ id: String, role: String = "assistant") throws -> JSONValue {
            try JSONDecoder().decode(JSONValue.self, from: Data("{\"id\":\"\(id)\",\"role\":\"\(role)\",\"content\":\"Your answer\"}".utf8))
        }
        #expect(NativeVoiceRules.latestSavedMessageMatches(message, rows: [try row("new-answer")]))
        #expect(!NativeVoiceRules.latestSavedMessageMatches(message, rows: [try row("old-answer")]))
        #expect(!NativeVoiceRules.latestSavedMessageMatches(message, rows: [try row("new-answer"), try row("user", role: "user")]))
        #expect(!NativeVoiceRules.latestSavedMessageMatches(message, rows: []))
    }

    @MainActor @Test("Teardown is idempotent and leaves no capture or permission preparation active")
    func teardown() {
        let input = NativeVoiceInput()
        input.wait()
        input.stop()
        input.stop()
        #expect(!input.isListening && !input.isEnabled && !input.isPreparing)
        input.fail("Microphone unavailable")
        #expect(input.status == "Microphone unavailable")
        #expect(!input.isListening && !input.isEnabled)
    }
}

/// Fake account IDs fail ClerkAuth's request-owner check before transport.
/// These checks run the shipping AppModel route helpers without a real login.
@Suite("Native voice navigation integration", .serialized)
@MainActor
struct NativeVoiceNavigationIntegrationTests {
    private func app() -> AppModel {
        AppModel(settings: SettingsStore(), userID: "unit-native-voice-\(UUID().uuidString)")
    }

    @MainActor
    private final class HeldDeparture {
        private var continuation: CheckedContinuation<Bool, Never>?
        private(set) var calls = 0
        func flush() async -> Bool {
            calls += 1
            return await withCheckedContinuation { continuation = $0 }
        }
        func finish(_ value: Bool) {
            let pending = continuation
            continuation = nil
            pending?.resume(returning: value)
        }
    }

    private func wait(_ condition: @MainActor () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(4)
        while !condition(), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(5))
        }
        try #require(condition(), "The held note departure did not start")
    }

    @Test("Notes commits under its original intent and reaches the native Notes destination")
    func ownedNotesDestination() async {
        let app = app()
        let request = app.beginNoteNavigation()
        #expect(app.commitStudy(.notes, request: request))
        #expect(app.navigationIntentID == request.intentID)
        #if os(macOS)
        #expect(app.section == .notes)
        #expect(app.pendingStudyRoute == nil)
        #else
        #expect(app.section == .study)
        #expect(app.pendingStudyRoute?.value == .notes)
        #expect(app.pendingStudyRoute?.request == request)
        var opened: StudyHubDestination?
        if let route = app.pendingStudyRoute {
            #expect(await app.consumeStudy(route) { opened = $0 })
        }
        #expect(opened == .notes)
        #expect(app.pendingStudyRoute == nil)
        #endif
    }

    @Test("Study leaf commit retains its caller's request instead of minting a second intent")
    func ownedStudyLeaf() {
        let app = app()
        let request = app.beginNoteNavigation()
        #expect(app.commitStudy(.words, request: request))
        #expect(app.section == .study)
        #expect(app.navigationIntentID == request.intentID)
        #expect(app.pendingStudyRoute?.value == .words)
        #expect(app.pendingStudyRoute?.request == request)
    }

    @Test("A newer intent defeats an old Study commit")
    func newerIntentDefeatsStudyCommit() {
        let app = app()
        let old = app.beginNoteNavigation()
        let newest = app.beginNoteNavigation()
        #expect(app.commitNavigationSection(.bible, request: newest))
        #expect(!app.commitStudy(.notes, request: old))
        #expect(app.section == .bible)
        #expect(app.pendingStudyRoute == nil)
        #expect(app.navigationIntentID == newest.intentID)
    }

    @Test("An account epoch change defeats an old Study commit")
    func changedEpochDefeatsStudyCommit() {
        let app = app()
        let old = app.beginNoteNavigation()
        NotesStore.shared.bindAccount("unit-native-voice-replacement-\(UUID().uuidString)")
        #expect(!app.commitStudy(.notes, request: old))
        #expect(app.section == .today)
        #expect(app.pendingStudyRoute == nil)
    }

    @Test("A voice route waiting on autosave cannot defeat a later section tap")
    func newerTapWinsHeldVoiceDeparture() async throws {
        let app = app()
        let held = HeldDeparture()
        app.noteDeparture.register(owner: UUID()) { await held.flush() }
        defer { held.finish(false) }
        let voiceRequest = app.beginNoteNavigation()
        var acknowledgments = 0
        let voice = Task {
            await app.performNoteNavigation(voiceRequest) {
                guard app.commitStudy(.notes, request: voiceRequest) else { return }
                acknowledgments += 1
            }
        }
        defer { voice.cancel() }
        try await wait { held.calls == 1 }
        let tap = app.beginNoteNavigation()
        #expect(app.commitNavigationSection(.bible, request: tap))
        held.finish(true)
        #expect(!(await voice.value))
        #expect(app.section == .bible)
        #expect(app.pendingStudyRoute == nil)
        #expect(acknowledgments == 0)
    }

    @Test("A failed note save keeps the editor's section and publishes no destination")
    func failedDepartureKeepsSection() async {
        let app = app()
        app.noteDeparture.register(owner: UUID()) { false }
        let request = app.beginNoteNavigation()
        let departed = await app.performNoteNavigation(request) {
            app.commitStudy(.notes, request: request)
        }
        #expect(!departed)
        #expect(app.section == .today)
        #expect(app.pendingStudyRoute == nil)
    }

    @Test("Cancellation during a held note save cannot publish the voice destination")
    func cancelledVoiceDeparture() async throws {
        let app = app()
        let held = HeldDeparture()
        app.noteDeparture.register(owner: UUID()) { await held.flush() }
        defer { held.finish(false) }
        let request = app.beginNoteNavigation()
        let voice = Task {
            await app.performNoteNavigation(request) { app.commitStudy(.notes, request: request) }
        }
        defer { voice.cancel() }
        try await wait { held.calls == 1 }
        voice.cancel()
        held.finish(true)
        #expect(!(await voice.value))
        #expect(app.section == .today)
        #expect(app.pendingStudyRoute == nil)
    }
}

@Suite("Native voice session binding", .serialized)
@MainActor
struct NativeVoiceSessionBindingTests {
    @MainActor
    private final class HeldPermission {
        var sessionID: String? = "original-session"
        var generation = 0
        var calls = 0
        private var continuation: CheckedContinuation<Bool, Never>?
        func request() async -> Bool {
            calls += 1
            return await withCheckedContinuation { continuation = $0 }
        }
        func finish(_ result: Bool) {
            let pending = continuation
            continuation = nil
            pending?.resume(returning: result)
        }
    }

    @Test("Only one nonempty owner and exact session can hold microphone authority")
    func exactSession() throws {
        let owner = try #require(NativeVoiceOwnerSession(accountID: "owner", sessionID: "original-session"))
        #expect(owner.matches(accountID: "owner", sessionID: "original-session"))
        #expect(!owner.matches(accountID: "owner", sessionID: "replacement-session"))
        #expect(!owner.matches(accountID: "different-owner", sessionID: "original-session"))
        #expect(!owner.matches(accountID: "owner", sessionID: nil))
        #expect(NativeVoiceOwnerSession(accountID: nil, sessionID: "session") == nil)
        #expect(NativeVoiceOwnerSession(accountID: "owner", sessionID: "") == nil)
    }

    @Test("Current session permission succeeds; denial stays denied")
    func stablePermission() async {
        #expect(await NativeVoiceRules.authorizedPermission(whileCurrent: { true }, request: { true }))
        #expect(!(await NativeVoiceRules.authorizedPermission(whileCurrent: { true }, request: { false })))
    }

    @Test("A pre-cancelled task never requests permission")
    func cancelledBeforePermission() async {
        var requests = 0
        let permission = Task {
            await NativeVoiceRules.authorizedPermission(whileCurrent: { true }) {
                requests += 1
                return true
            }
        }
        permission.cancel()
        #expect(!(await permission.value))
        #expect(requests == 0)
    }

    @Test("Task cancellation alone rejects a delayed grant for the same session")
    func cancelledWhilePermissionIsHeld() async throws {
        let held = HeldPermission()
        defer { held.finish(false) }
        let permission = Task {
            await NativeVoiceRules.authorizedPermission(whileCurrent: { true }, request: { await held.request() })
        }
        defer { permission.cancel() }
        let deadline = ContinuousClock.now + .seconds(4)
        while held.calls == 0, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(5))
        }
        try #require(held.calls == 1)
        permission.cancel()
        held.finish(true)
        #expect(!(await permission.value))
    }

    @Test("An obsolete owner never requests permission")
    func staleBeforePermission() async {
        var requests = 0
        let granted = await NativeVoiceRules.authorizedPermission(whileCurrent: { false }) {
            requests += 1
            return true
        }
        #expect(!granted)
        #expect(requests == 0)
    }

    @Test("A delayed permission cannot rearm after session replacement or Stop", arguments: [false, true])
    func heldPermissionIsFenced(stop: Bool) async throws {
        let held = HeldPermission()
        defer { held.finish(false) }
        let owner = try #require(NativeVoiceOwnerSession(accountID: "owner", sessionID: held.sessionID))
        let generation = held.generation
        let permission = Task {
            await NativeVoiceRules.authorizedPermission(whileCurrent: {
                held.generation == generation && owner.matches(accountID: "owner", sessionID: held.sessionID)
            }, request: { await held.request() })
        }
        defer { permission.cancel() }
        let deadline = ContinuousClock.now + .seconds(4)
        while held.calls == 0, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(5))
        }
        try #require(held.calls == 1)
        if stop { held.generation += 1 }
        else { held.sessionID = "replacement-session" }
        held.finish(true)
        #expect(!(await permission.value))
    }
}
