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
    case textScale, name, faith, walk, testimony, church, prayer, dailyTime, tour, aboutMe, other
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
    /// Words in the question that open their glossary explanation when tapped.
    var terms: [GlossaryTerm] = []
}

/// What a presentChoices card resolves to, after the server fills in the script.
struct OnboardingChoiceCard: Sendable, Equatable {
    var step: OnboardingStep
    var question: String
    var options: [String]
    var allowOther: Bool
    var skipLabel: String
    var terms: [GlossaryTerm] = []
}

/// A word in a card's question the reader can tap for a plain, Scripture
/// explanation (Austin, 2026-10-26: tap "saved" to learn what it means). The
/// raw value is the exact word as it appears in the question.
enum GlossaryTerm: String, CaseIterable, Sendable, Equatable, Identifiable {
    case saved

    var id: String { rawValue }
}

struct GlossaryVerse: Sendable, Equatable {
    var reference: String
    /// KJV, word for word (`tests/onboarding-rules.test.mjs` checks the web copy).
    var text: String
}

struct GlossarySection: Sendable, Equatable {
    var text: String
    var verses: [GlossaryVerse]
}

struct GlossaryEntry: Sendable, Equatable {
    var title: String
    var sections: [GlossarySection]
    /// The question "Talk with SureWord about this" sends as their answer.
    var ask: String
}

/// One run of a card's question: plain words, or a tappable glossary word.
struct QuestionSegment: Sendable, Equatable {
    var text: String
    var term: GlossaryTerm?
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
        "Welcome to SureWord. I'm here to walk with you in God's Word, wherever you are with Him. First, I would like to get to know you: your name, where you are with the Lord, your church and what is on your heart. It matters, because everything I do for you grows from it: how I answer your questions, how I pray with you, and the verse and devotional I prepare for you each morning. It takes about five minutes, and you can skip anything. If you would rather listen, turn on Read it to me at the top, and I will read each message to you."

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
            question: "Where are you with the Lord, and have you been saved? Pick the one that sounds most like you.",
            options: faithOptions,
            allowOther: true,
            skipLabel: "Skip for now",
            terms: [.saved]
        ),
        .walk: OnboardingStepCard(
            question: "How long have you walked with the Lord?",
            options: ["Less than a year", "A few years", "Ten years or more", "Most of my life"],
            allowOther: true,
            skipLabel: "Skip for now"
        ),
        .testimony: OnboardingStepCard(
            question: "Would you tell me how you came to know the Lord? Type it or speak it in your own words. I will keep it as your testimony, and you can change it any time in Settings.",
            options: [],
            allowOther: true,
            skipLabel: "Not now"
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
            skipLabel: card.skipLabel,
            terms: card.terms
        )
    }

    /// `GLOSSARY`: the words a card can explain, fixed and free, never generated.
    static let glossary: [GlossaryTerm: GlossaryEntry] = [
        .saved: GlossaryEntry(
            title: "What does it mean to be saved?",
            sections: [
                GlossarySection(
                    text: "To be saved is to be rescued by God from the penalty of your sin and given eternal life through Jesus Christ. The Bible also calls it being born again.",
                    verses: [
                        GlossaryVerse(reference: "John 3:3", text: "Jesus answered and said unto him, Verily, verily, I say unto thee, Except a man be born again, he cannot see the kingdom of God."),
                    ]
                ),
                GlossarySection(
                    text: "Every one of us has sinned, and sin separates us from a holy God.",
                    verses: [
                        GlossaryVerse(reference: "Romans 3:23", text: "For all have sinned, and come short of the glory of God;"),
                        GlossaryVerse(reference: "Romans 6:23", text: "For the wages of sin is death; but the gift of God is eternal life through Jesus Christ our Lord."),
                    ]
                ),
                GlossarySection(
                    text: "But God loved us first. Jesus Christ, His Son, died on the cross for our sins and rose again the third day.",
                    verses: [
                        GlossaryVerse(reference: "Romans 5:8", text: "But God commendeth his love toward us, in that, while we were yet sinners, Christ died for us."),
                        GlossaryVerse(reference: "John 3:16", text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."),
                    ]
                ),
                GlossarySection(
                    text: "Salvation is a gift. Nobody earns it by good works, by being a good person or by joining a church. It is received by faith, trusting Christ alone.",
                    verses: [
                        GlossaryVerse(reference: "Ephesians 2:8-9", text: "For by grace are ye saved through faith; and that not of yourselves: it is the gift of God: Not of works, lest any man should boast."),
                    ]
                ),
                GlossarySection(
                    text: "Whoever turns to Him, believing in their heart that God raised Him from the dead, and calls on His name, is saved.",
                    verses: [
                        GlossaryVerse(reference: "Romans 10:9", text: "That if thou shalt confess with thy mouth the Lord Jesus, and shalt believe in thine heart that God hath raised him from the dead, thou shalt be saved."),
                        GlossaryVerse(reference: "Romans 10:13", text: "For whosoever shall call upon the name of the Lord shall be saved."),
                    ]
                ),
                GlossarySection(
                    text: "A saved person is a new creature in Christ, and can know for certain that they have eternal life. If you are not sure where you stand, that is all right. We can look at it together in God's Word.",
                    verses: [
                        GlossaryVerse(reference: "2 Corinthians 5:17", text: "Therefore if any man be in Christ, he is a new creature: old things are passed away; behold, all things are become new."),
                        GlossaryVerse(reference: "1 John 5:13", text: "These things have I written unto you that believe on the name of the Son of God; that ye may know that ye have eternal life, and that ye may believe on the name of the Son of God."),
                    ]
                ),
            ],
            ask: "What does it mean to be saved?"
        ),
    ]

    /// The question split around its tappable words (`questionSegments`), so
    /// every client links the same word. Only a term's first whole-word match.
    static func questionSegments(_ question: String, terms: [GlossaryTerm]) -> [QuestionSegment] {
        var segments: [QuestionSegment] = []
        var rest = Substring(question)
        var pending = terms
        while !rest.isEmpty {
            var best: (range: Range<Substring.Index>, term: GlossaryTerm)?
            for term in pending {
                guard let range = wholeWord(term.rawValue, in: rest) else { continue }
                if let current = best, current.range.lowerBound <= range.lowerBound { continue }
                best = (range, term)
            }
            guard let found = best else {
                segments.append(QuestionSegment(text: String(rest)))
                break
            }
            if found.range.lowerBound > rest.startIndex {
                segments.append(QuestionSegment(text: String(rest[rest.startIndex..<found.range.lowerBound])))
            }
            segments.append(QuestionSegment(text: String(rest[found.range]), term: found.term))
            rest = rest[found.range.upperBound...]
            pending.removeAll { $0 == found.term }
        }
        return segments
    }

    /// The first case-insensitive match of `word` with no letter, digit or
    /// underscore on either side (the web's `\b`).
    private static func wholeWord(_ word: String, in text: Substring) -> Range<Substring.Index>? {
        func isWordCharacter(_ character: Character?) -> Bool {
            guard let character else { return false }
            return character.isLetter || character.isNumber || character == "_"
        }
        var searchStart = text.startIndex
        while let range = text.range(of: word, options: .caseInsensitive, range: searchStart..<text.endIndex) {
            let before = range.lowerBound > text.startIndex ? text[text.index(before: range.lowerBound)] : nil
            let after = range.upperBound < text.endIndex ? text[range.upperBound] : nil
            if !isWordCharacter(before), !isWordCharacter(after) { return range }
            searchStart = range.upperBound
        }
        return nil
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
              let rawStep = output["step"]?.stringValue,
              let question = output["question"]?.stringValue
        else { return nil }
        // A step newer than this build still draws, as a card the model wrote,
        // so a server that adds a step never strands an older app.
        let step = OnboardingStep(rawValue: rawStep) ?? .other
        let options = (output["options"]?.arrayValue ?? []).compactMap(\.stringValue)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let skip = output["skipLabel"]?.stringValue ?? ""
        return OnboardingChoiceCard(
            step: step,
            question: question,
            options: options,
            allowOther: output["allowOther"]?.boolValue == true,
            skipLabel: skip.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Skip for now" : skip,
            // A card stored before tappable words existed has none.
            terms: (output["terms"]?.arrayValue ?? []).compactMap { $0.stringValue.flatMap(GlossaryTerm.init(rawValue:)) }
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
