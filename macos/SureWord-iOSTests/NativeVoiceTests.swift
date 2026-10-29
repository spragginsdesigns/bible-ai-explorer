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
