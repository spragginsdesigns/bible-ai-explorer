import Foundation

/// "Walk with me", the guided first run (docs/onboarding/PLAN.md): the pure
/// vocabulary every client agrees on. Mirrored by hand from
/// `src/lib/onboarding-rules.ts` (and the card helpers in
/// `src/lib/guide-cards.ts`), the same way
/// `mobile/src/features/onboarding/onboardingRules.ts` mirrors it;
/// `OnboardingTests` pin the copy, so change all three together.
///
/// The server decides the order and owns the scripted copy. This client only
/// knows how to draw a card, what each tap does on this device, and how to
/// light up its own screens.
enum OnboardingStep: String, CaseIterable, Sendable, Equatable {
    case textScale, name, faith, church, prayer, dailyTime, tour, aboutMe, other
}

/// One scripted card. `options == nil` means the model supplies them (the
/// name step).
struct OnboardingStepCard: Sendable, Equatable {
    var question: String
    var options: [String]?
    /// "Type my own" (and the microphone, where a client has one).
    var allowOther: Bool
    /// The quiet way past the card. Always present: nothing is required.
    var skipLabel: String
}

/// What a presentChoices card resolves to, after the server fills in the script.
struct OnboardingChoiceCard: Sendable, Equatable {
    var step: OnboardingStep
    var question: String
    var options: [String]
    var allowOther: Bool
    var skipLabel: String
}

/// The places SureWord can light up, by stable name. A client that cannot
/// show one skips it silently.
enum AppTarget: String, CaseIterable, Sendable, Equatable {
    case tabToday = "tab.today"
    case tabBible = "tab.bible"
    case tabChat = "tab.chat"
    case tabStudy = "tab.study"
    case tabConnections = "tab.connections"
    case todayCross = "today.cross"
    case todayLearn = "today.learn"
    case todayPlan = "today.plan"
    case readerVerse = "reader.verse"
    case studySermons = "study.sermons"
    case studyNotes = "study.notes"
    case settingsChurch = "settings.church"
    case settingsTextSize = "settings.textSize"
    case chatMic = "chat.mic"
    case tour

    /// The section a target lives in, for the trip there before it is lit.
    var section: AppSection? {
        switch self {
        case .tabToday, .todayCross, .todayLearn, .todayPlan: .today
        case .tabBible, .readerVerse: .bible
        case .tabChat, .chatMic: .chat
        case .tabStudy, .studySermons, .studyNotes: .study
        case .tabConnections: .connections
        case .settingsChurch, .settingsTextSize, .tour: nil
        }
    }

    var isSettings: Bool { self == .settingsChurch || self == .settingsTextSize }
}

extension AppSection {
    /// The tab stop a primary section answers to.
    var tabTarget: AppTarget {
        switch primary {
        case .bible: .tabBible
        case .chat: .tabChat
        case .connections: .tabConnections
        case .study, .notes: .tabStudy
        case .today, .cross: .tabToday
        }
    }

    /// The "?" a primary section carries.
    var helpScreen: HelpScreen {
        switch primary {
        case .today, .cross: .today
        case .bible: .bible
        case .chat: .chat
        case .connections: .connections
        case .study, .notes: .study
        }
    }
}

struct TourStop: Sendable, Equatable {
    var target: AppTarget
    var caption: String
}

/// A showInApp card: a caption and a "Show me" button.
struct ShowInAppCard: Sendable, Equatable {
    var target: AppTarget
    var caption: String
    /// Only for target `.tour`: the stops to play, in order.
    var stops: [TourStop] = []
}

/// The Getting started card's rows, each ticked only by real use.
enum GettingStartedKey: String, CaseIterable, Sendable {
    case readChapter, tapVerse, dailyWord, learnVerse, church
}

struct GettingStartedItem: Sendable, Equatable {
    var key: GettingStartedKey
    var label: String
    var target: AppTarget
    var ask: String
}

/// The screens with a "?" help button.
enum HelpScreen: String, CaseIterable, Sendable {
    case today, bible, chat, study, connections

    /// What the button sends.
    var message: String {
        switch self {
        case .today: "Help me with the Today screen."
        case .bible: "Help me with the Bible reader."
        case .chat: "Help me with Chat."
        case .study: "Help me with the Study tab."
        case .connections: "Help me with Connections."
        }
    }
}

enum OnboardingRules {
    /// SureWord's first message, seeded by POST /api/onboarding/start.
    static let welcomeText =
        "Welcome to SureWord. I'm here to walk with you in God's Word, wherever you are with Him. This takes about five minutes, and you can skip anything. If you would rather listen, turn on Read it to me at the top, and I will read each message to you."

    /// The conversation's title in history.
    static let welcomeTitle = "Welcome to SureWord"

    /// The faith step's six answers, from the original "Getting to know you" list.
    static let faithOptions = [
        "A pastor, elder or preacher",
        "Serving in ministry",
        "A Bible teacher or group leader",
        "Saved and growing in the Word",
        "Newly saved",
        "Still seeking, or not sure where I stand with God",
    ]

    /// The daily word's hour chips; "Pick a time" opens the hour picker.
    static let dailyTimeOptions = ["6 am", "7 am", "8 am", "Noon", "7 pm", "Pick a time"]

    /// The chip that opens the hour picker instead of naming an hour.
    static let pickATime = "Pick a time"

    /// The local hour each fixed chip means.
    static let dailyTimeHours: [String: Int] = [
        "6 am": 6,
        "7 am": 7,
        "8 am": 8,
        "Noon": 12,
        "7 pm": 19,
    ]

    static let textScaleOptions = ["Standard", "Large", "Largest"]

    /// The scripted card for each step. `other` has no script: the model writes it.
    static let stepCards: [OnboardingStep: OnboardingStepCard] = [
        .textScale: OnboardingStepCard(
            question: "First, is this easy to read? Pick the size that feels best.",
            options: textScaleOptions,
            allowOther: false,
            skipLabel: "Skip for now"
        ),
        .name: OnboardingStepCard(
            question: "What should I call you?",
            options: nil,
            allowOther: true,
            skipLabel: "Skip for now"
        ),
        .faith: OnboardingStepCard(
            question: "Which of these sounds most like you?",
            options: faithOptions,
            allowOther: true,
            skipLabel: "Skip for now"
        ),
        .church: OnboardingStepCard(
            question: "Do you have a home church? Search for it here, and I will remember it.",
            options: [],
            allowOther: false,
            skipLabel: "Not right now"
        ),
        .prayer: OnboardingStepCard(
            question: "Is there anything you would like me to pray about with you, or anything you are walking through right now?",
            options: ["Pray for my family", "Pray for my health", "Help me grow closer to God"],
            allowOther: true,
            skipLabel: "Not today"
        ),
        .dailyTime: OnboardingStepCard(
            question: "Every morning I can send you a verse and a short devotional made for where you are. What time works for you?",
            options: dailyTimeOptions,
            allowOther: false,
            skipLabel: "Not now"
        ),
        .tour: OnboardingStepCard(
            question: "Would you like me to show you around? It takes about a minute.",
            options: ["Show me around"],
            allowOther: false,
            skipLabel: "Later"
        ),
        .aboutMe: OnboardingStepCard(
            question: "Would you like me to save a short About me from what you have told me, so I always remember?",
            options: ["Yes, save it"],
            allowOther: false,
            skipLabel: "Not now"
        ),
    ]

    private static let maxOptionLength = 80

    /// The card the client draws: `resolveChoiceCard`. For a scripted step the
    /// question and fixed options always come from the script, whatever the
    /// model sent. The name step keeps the model's prefilled options; `other`
    /// keeps everything the model wrote, within bounds.
    static func resolveChoiceCard(
        step: OnboardingStep,
        question: String? = nil,
        options: [String]? = nil,
        allowOther: Bool? = nil
    ) -> OnboardingChoiceCard {
        var cleanOptions: [String] = []
        for option in options ?? [] {
            let trimmed = String(option.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxOptionLength))
            if !trimmed.isEmpty, !cleanOptions.contains(trimmed) { cleanOptions.append(trimmed) }
        }
        cleanOptions = Array(cleanOptions.prefix(6))
        guard step != .other, let card = stepCards[step] else {
            return OnboardingChoiceCard(
                step: .other,
                question: String((question ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(300)),
                options: cleanOptions,
                allowOther: allowOther != false,
                skipLabel: "Skip for now"
            )
        }
        return OnboardingChoiceCard(
            step: step,
            question: card.question,
            options: card.options ?? Array(cleanOptions.prefix(2)),
            allowOther: card.allowOther,
            skipLabel: card.skipLabel
        )
    }

    /// The tour, in order, in SureWord's voice. Every client plays these stops.
    static let tourStops: [TourStop] = [
        TourStop(target: .tabToday, caption: "Today is where each day starts: your Pick Up Your Cross, your reading plan and the verses you are learning."),
        TourStop(target: .tabBible, caption: "Here is the whole Bible. Read any chapter, any time, even offline."),
        TourStop(target: .tabChat, caption: "Chat is where we talk. Ask me anything about Scripture, whenever you like."),
        TourStop(target: .tabStudy, caption: "Study keeps your notes, word studies and the sermon studies from your church."),
        TourStop(target: .tabConnections, caption: "Connections shows how Scripture ties together: its people, places and events."),
        TourStop(target: .readerVerse, caption: "Last one. Tap any verse in the Bible and I will explain it to you. Try this one."),
    ]

    static let gettingStartedItems: [GettingStartedItem] = [
        GettingStartedItem(key: .readChapter, label: "Read a chapter", target: .tabBible, ask: "How do I read a chapter in the Bible?"),
        GettingStartedItem(key: .tapVerse, label: "Tap a verse", target: .readerVerse, ask: "How do I tap a verse to have it explained?"),
        GettingStartedItem(key: .dailyWord, label: "Your daily word", target: .todayCross, ask: "What is Pick Up Your Cross?"),
        GettingStartedItem(key: .learnVerse, label: "Learn a verse", target: .todayLearn, ask: "How do I learn a verse by heart?"),
        GettingStartedItem(key: .church, label: "Your church", target: .settingsChurch, ask: "How do I add my home church?"),
    ]

    /// The user message "Walk me through SureWord" sends to pick the welcome back up.
    static let resumeMessage = "Walk me through SureWord."

    /// The tour's "Show me around" answer, sent when the tour starts.
    static let showMeAround = "Show me around"

    /// John 3:16: the verse the tour ends on.
    static let tourVerseReference = "John 3:16"
    static let tourVerseNumber = 16

    // MARK: Parsing tool parts

    /// A presentChoices output as the client can trust it. The server already
    /// ran `resolveChoiceCard`, but a stored row outlives any deploy, so the
    /// shape is checked again rather than assumed (`parseChoiceCard`).
    static func parseChoiceCard(_ output: JSONValue?) -> OnboardingChoiceCard? {
        guard let output, output.objectValue != nil,
              let step = output["step"]?.stringValue.flatMap(OnboardingStep.init(rawValue:)),
              let question = output["question"]?.stringValue
        else { return nil }
        let options = (output["options"]?.arrayValue ?? []).compactMap(\.stringValue)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let skip = output["skipLabel"]?.stringValue ?? ""
        return OnboardingChoiceCard(
            step: step,
            question: question,
            options: options,
            allowOther: output["allowOther"]?.boolValue == true,
            skipLabel: skip.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Skip for now" : skip
        )
    }

    /// A showInApp output (`parseShowInApp`): an unknown target drops the card.
    static func parseShowInApp(_ output: JSONValue?) -> ShowInAppCard? {
        guard let output, output.objectValue != nil,
              let target = output["target"]?.stringValue.flatMap(AppTarget.init(rawValue:)),
              let caption = output["caption"]?.stringValue
        else { return nil }
        let stops = (output["stops"]?.arrayValue ?? []).compactMap { stop -> TourStop? in
            guard let target = stop["target"]?.stringValue.flatMap(AppTarget.init(rawValue:)),
                  let caption = stop["caption"]?.stringValue
            else { return nil }
            return TourStop(target: target, caption: caption)
        }
        return ShowInAppCard(target: target, caption: caption, stops: stops)
    }

    /// The seeded first message's card carries a `welcome-` tool call id,
    /// which is how a client knows this conversation is the welcome without
    /// asking the server.
    static func isWelcomeToolCallID(_ id: String) -> Bool {
        id.hasPrefix("welcome-")
    }

    // MARK: Card state

    struct CardState: Sendable, Equatable {
        /// The one card that still takes a tap: the newest, unanswered, and
        /// not mid-answer.
        var active: Bool
        /// What they replied with, for an answered card.
        var answer: String?
    }

    /// Every card's state in one pass (`cardStates`). Only the newest
    /// message's card can be live, and only while nothing is streaming: an
    /// older card's buttons would answer a question SureWord has moved past.
    static func cardStates(_ messages: [ChatViewMessage], busy: Bool) -> [String: CardState] {
        var states: [String: CardState] = [:]
        for (index, message) in messages.enumerated() {
            guard message.role == .assistant, message.choiceCard != nil else { continue }
            let next = index + 1 < messages.count ? messages[index + 1] : nil
            let answer = next?.role == .user
                ? next.map { $0.content.trimmingCharacters(in: .whitespacesAndNewlines) }.flatMap { $0.isEmpty ? nil : $0 }
                : nil
            states[message.id] = CardState(active: index == messages.count - 1 && !busy, answer: answer)
        }
        return states
    }

    // MARK: Voice

    enum VoiceItem: Sendable, Equatable {
        case message(String)
        case step(OnboardingStep)
    }

    /// What voice mode reads for one of SureWord's messages: the message, then
    /// the card's scripted question when there is one. An `other` card has no
    /// scripted line, and its question is already in the message.
    static func voiceItems(for message: ChatViewMessage) -> [VoiceItem] {
        var items: [VoiceItem] = [.message(message.id)]
        if let card = message.choiceCard, card.step != .other { items.append(.step(card.step)) }
        return items
    }

    /// When voice mode starts, the newest settled message is read and the rest
    /// count as already heard, so turning it on never reads the history back.
    /// A reply still being written is the newest, so every settled one counts.
    static func alreadyHeardOnStart(_ messages: [ChatViewMessage]) -> [String] {
        let assistant = messages.filter { $0.role == .assistant }
        let settled = assistant.filter { !$0.isStreaming }.map(\.id)
        if assistant.last?.isStreaming == true { return settled }
        return Array(settled.dropLast())
    }
}
