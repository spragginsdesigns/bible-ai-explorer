import Foundation
import SwiftUI
import Testing

@testable import SureWord

/// Walk with me on Apple: the hand mirror of `src/lib/onboarding-rules.ts`
/// and `src/lib/guide-cards.ts`, the text size mapping, and the tool part
/// parsing both apps' chat screens read. Mirrors the pure halves of
/// `onboarding-rules.test.ts` and `guide-cards.test.ts`.
@Suite("Walk with me rules")
struct OnboardingTests {
    private static func assistant(
        _ id: String,
        card: OnboardingChoiceCard? = nil,
        streaming: Bool = false
    ) -> ChatViewMessage {
        ChatViewMessage(id: id, role: .assistant, content: "Message \(id)", isStreaming: streaming, choiceCard: card)
    }

    private static func user(_ id: String, _ content: String) -> ChatViewMessage {
        ChatViewMessage(id: id, role: .user, content: content)
    }

    private static let faithCard = OnboardingRules.resolveChoiceCard(step: .faith)

    private static func decode(_ json: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
    }

    // MARK: Script

    @Test("A scripted step always draws the script, whatever the model sent")
    func scriptedStepWins() {
        let card = OnboardingRules.resolveChoiceCard(
            step: .faith,
            question: "Something else entirely?",
            options: ["One", "Two"],
            allowOther: false
        )
        #expect(card.step == .faith)
        #expect(card.question == "Which of these sounds most like you?")
        #expect(card.options == OnboardingRules.faithOptions)
        #expect(card.allowOther)
        #expect(card.skipLabel == "Skip for now")
    }

    @Test("The name step keeps up to two of the model's options, trimmed and unique")
    func nameKeepsModelOptions() {
        let card = OnboardingRules.resolveChoiceCard(step: .name, options: ["  Austin ", "Austin", "", "Brother Austin", "Third"])
        #expect(card.options == ["Austin", "Brother Austin"])
        #expect(card.allowOther)
    }

    @Test("An other card keeps the model's words within bounds")
    func otherCardBounds() {
        let long = String(repeating: "a", count: 120)
        let card = OnboardingRules.resolveChoiceCard(
            step: .other,
            question: "  How are you?  ",
            options: ["1", "2", "3", "4", "5", "6", "7", long]
        )
        #expect(card.step == .other)
        #expect(card.question == "How are you?")
        #expect(card.options == ["1", "2", "3", "4", "5", "6"])
        #expect(card.allowOther)
        #expect(card.skipLabel == "Skip for now")
        #expect(OnboardingRules.resolveChoiceCard(step: .other, options: [long]).options.first?.count == 80)
        #expect(OnboardingRules.resolveChoiceCard(step: .other, allowOther: false).allowOther == false)
    }

    @Test("Every step but other has a script, and every skip is quiet")
    func everyStepScripted() {
        for step in OnboardingStep.allCases where step != .other {
            let card = OnboardingRules.stepCards[step]
            #expect(card != nil, "missing script for \(step)")
            #expect(card?.skipLabel.isEmpty == false)
        }
        #expect(OnboardingRules.stepCards[.other] == nil)
        #expect(OnboardingRules.stepCards[.church]?.skipLabel == "Not right now")
        #expect(OnboardingRules.stepCards[.tour]?.options == [OnboardingRules.showMeAround])
    }

    @Test("Each fixed daily time chip names a real hour, and Pick a time names none")
    func dailyTimeChips() {
        for option in OnboardingRules.dailyTimeOptions where option != OnboardingRules.pickATime {
            #expect(OnboardingRules.dailyTimeHours[option] != nil, "\(option) has no hour")
        }
        #expect(OnboardingRules.dailyTimeHours[OnboardingRules.pickATime] == nil)
        #expect(OnboardingRules.dailyTimeHours["Noon"] == 12)
        #expect(OnboardingRules.dailyTimeHours["7 pm"] == 19)
    }

    @Test("Hour labels round-trip for every pickable hour")
    func hourLabels() {
        for hour in OnboardingRules.pickableHours {
            let label = OnboardingRules.hourLabel(hour)
            #expect(OnboardingRules.hour(forLabel: label) == hour, "\(label) did not round-trip")
        }
        #expect(OnboardingRules.hour(forLabel: "Noon") == 12)
        #expect(OnboardingRules.hour(forLabel: "6 am") == 6)
        #expect(OnboardingRules.hour(forLabel: "Whenever") == nil)
    }

    @Test("The tour plays every tab, then ends on a verse")
    func tourOrder() {
        #expect(OnboardingRules.tourStops.map(\.target) == [
            .tabToday, .tabBible, .tabChat, .tabStudy, .tabConnections, .readerVerse,
        ])
        #expect(OnboardingRules.tourVerseReference == "John 3:16")
        #expect(OnboardingRules.tourVerseNumber == 16)
    }

    @Test("Targets keep their wire names and live in the right section")
    func targetNames() {
        #expect(AppTarget(rawValue: "settings.textSize") == .settingsTextSize)
        #expect(AppTarget(rawValue: "reader.verse") == .readerVerse)
        #expect(AppTarget(rawValue: "tour") == .tour)
        #expect(AppTarget.todayCross.section == .today)
        #expect(AppTarget.studyNotes.section == .study)
        #expect(AppTarget.readerVerse.section == .bible)
        #expect(AppTarget.settingsChurch.section == nil)
        #expect(AppTarget.settingsChurch.isSettings)
        #expect(!AppTarget.tabChat.isSettings)
        #expect(AppSection.notes.tabTarget == .tabStudy)
        #expect(AppSection.cross.helpScreen == .today)
    }

    @Test("Help buttons send the server's help phrases")
    func helpMessages() {
        #expect(HelpScreen.today.message == "Help me with the Today screen.")
        #expect(HelpScreen.bible.message == "Help me with the Bible reader.")
        #expect(HelpScreen.connections.message == "Help me with Connections.")
    }

    // MARK: Parsing

    @Test("A stored presentChoices output parses, and a broken one is dropped")
    func parseChoiceCard() throws {
        let card = try #require(OnboardingRules.parseChoiceCard(try Self.decode("""
        {"step": "dailyTime", "question": "What time?", "options": ["6 am", " ", 7, "Noon"],
         "allowOther": true, "skipLabel": "  "}
        """)))
        #expect(card.step == .dailyTime)
        #expect(card.options == ["6 am", "Noon"])
        #expect(card.allowOther)
        #expect(card.skipLabel == "Skip for now")
        #expect(OnboardingRules.parseChoiceCard(try Self.decode(#"{"step": "dance", "question": "Q"}"#)) == nil)
        #expect(OnboardingRules.parseChoiceCard(try Self.decode(#"{"step": "faith"}"#)) == nil)
        #expect(OnboardingRules.parseChoiceCard(try Self.decode(#"["faith"]"#)) == nil)
        #expect(OnboardingRules.parseChoiceCard(nil) == nil)
    }

    @Test("A showInApp output keeps known stops and drops an unknown target")
    func parseShowInApp() throws {
        let card = try #require(OnboardingRules.parseShowInApp(try Self.decode("""
        {"target": "tour", "caption": "Let me show you.",
         "stops": [{"target": "tab.today", "caption": "Today"}, {"target": "tab.moon", "caption": "No"},
                   {"target": "reader.verse", "caption": "Tap"}]}
        """)))
        #expect(card.target == .tour)
        #expect(card.stops.map(\.target) == [.tabToday, .readerVerse])
        #expect(OnboardingRules.parseShowInApp(try Self.decode(#"{"target": "tab.moon", "caption": "No"}"#)) == nil)
        let plain = try #require(OnboardingRules.parseShowInApp(try Self.decode(#"{"target": "today.learn", "caption": "Learn"}"#)))
        #expect(plain.stops.isEmpty)
    }

    @Test("The welcome message carries its card and is known by its tool call id")
    func welcomeMessageParses() throws {
        let row = try Self.decode("""
        {"id": "w", "role": "assistant", "content": "Welcome to SureWord.",
         "metadata": {"parts": [
           {"type": "text", "text": "Welcome to SureWord."},
           {"type": "tool-presentChoices", "toolCallId": "welcome-abc", "state": "output-available",
            "input": {"step": "textScale"},
            "output": {"step": "textScale", "question": "Is this easy to read?",
                       "options": ["Standard", "Large", "Largest"], "allowOther": false, "skipLabel": "Skip for now"}},
           {"type": "tool-showInApp", "toolCallId": "s1", "state": "output-available",
            "input": {"target": "today.cross"},
            "output": {"target": "today.cross", "caption": "Your daily word lives here."}}
         ]}}
        """)
        let message = ChatViewMessage(message: try #require(UIMessage(storedRow: row)), isStreaming: false)
        #expect(message.isWelcome)
        #expect(message.choiceCard?.step == .textScale)
        #expect(message.choiceCard?.options == ["Standard", "Large", "Largest"])
        #expect(message.showMe.map(\.target) == [.todayCross])
        #expect(message.hasRenderableContent)
        #expect(OnboardingRules.isWelcomeToolCallID("welcome-1"))
        #expect(!OnboardingRules.isWelcomeToolCallID("call_welcome-1"))
    }

    @Test("A later card from the model is not the welcome")
    func laterCardIsNotWelcome() throws {
        let row = try Self.decode("""
        {"id": "m", "role": "assistant", "content": "",
         "metadata": {"parts": [
           {"type": "tool-presentChoices", "toolCallId": "call_9", "state": "output-available",
            "output": {"step": "name", "question": "What should I call you?", "options": ["Austin"],
                       "allowOther": true, "skipLabel": "Skip for now"}}
         ]}}
        """)
        let message = ChatViewMessage(message: try #require(UIMessage(storedRow: row)), isStreaming: false)
        #expect(!message.isWelcome)
        #expect(message.choiceCard?.step == .name)
        #expect(message.hasRenderableContent)
    }

    // MARK: Card state

    @Test("Only the newest card takes a tap, and only while nothing streams")
    func cardStates() {
        let messages = [
            Self.assistant("a1", card: Self.faithCard),
            Self.user("u1", "  Newly saved  "),
            Self.assistant("a2", card: Self.faithCard),
        ]
        let states = OnboardingRules.cardStates(messages, busy: false)
        #expect(states["a1"] == OnboardingRules.CardState(active: false, answer: "Newly saved"))
        #expect(states["a2"] == OnboardingRules.CardState(active: true, answer: nil))
        #expect(states["u1"] == nil)
        #expect(OnboardingRules.cardStates(messages, busy: true)["a2"]?.active == false)
    }

    @Test("A message without a card has no state, and a blank reply is no answer")
    func cardStatesSkipPlainMessages() {
        let messages = [
            Self.assistant("a1"),
            Self.assistant("a2", card: Self.faithCard),
            Self.user("u1", "   "),
        ]
        let states = OnboardingRules.cardStates(messages, busy: false)
        #expect(states["a1"] == nil)
        #expect(states["a2"] == OnboardingRules.CardState(active: false, answer: nil))
    }

    // MARK: Voice

    @Test("Voice reads the message, then the scripted question, and never an other card's")
    func voiceItems() {
        #expect(OnboardingRules.voiceItems(for: Self.assistant("a", card: Self.faithCard)) == [.message("a"), .step(.faith)])
        let other = OnboardingRules.resolveChoiceCard(step: .other, question: "How?")
        #expect(OnboardingRules.voiceItems(for: Self.assistant("b", card: other)) == [.message("b")])
        #expect(OnboardingRules.voiceItems(for: Self.assistant("c")) == [.message("c")])
    }

    @Test("Turning voice on reads only the newest settled message")
    func alreadyHeard() {
        let settled = [Self.assistant("a1"), Self.user("u", "Hi"), Self.assistant("a2")]
        #expect(OnboardingRules.alreadyHeardOnStart(settled) == ["a1"])
        let writing = [Self.assistant("a1"), Self.user("u", "Hi"), Self.assistant("a2", streaming: true)]
        #expect(OnboardingRules.alreadyHeardOnStart(writing) == ["a1"])
        #expect(OnboardingRules.alreadyHeardOnStart([]) == [])
    }

    // MARK: Text size

    @Test("Text sizes match the server's names and factors")
    func textScaleMapping() {
        #expect(TextScale.allCases.map(\.rawValue) == ["standard", "large", "largest"])
        #expect(TextScale.allCases.map(\.label) == OnboardingRules.textScaleOptions)
        #expect(TextScale.allCases.map(\.factor) == [1, 1.15, 1.3])
        #expect(TextScale(label: "Large") == .large)
        #expect(TextScale(label: "large") == nil)
        #expect(TextScale.normalize("largest") == .largest)
        #expect(TextScale.normalize("huge") == .standard)
        #expect(TextScale.normalize(nil) == .standard)
    }

    @Test("A size steps Dynamic Type up from the system's and stops at the top")
    func textScaleDynamicType() {
        #expect(TextScale.standard.dynamicTypeSize(over: .large) == .large)
        #expect(TextScale.large.dynamicTypeSize(over: .large) == .xxLarge)
        #expect(TextScale.largest.dynamicTypeSize(over: .large) == .accessibility1)
        #expect(TextScale.largest.dynamicTypeSize(over: .accessibility4) == .accessibility5)
    }
}
