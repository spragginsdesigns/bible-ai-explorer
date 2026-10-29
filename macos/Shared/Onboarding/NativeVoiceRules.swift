import Foundation

/// Deliberately exact: speech must never guess a testimony, setting or choice.
enum NativeVoiceCommand: Equatable {
    case choose(String), navigate(String), back, repeatOptions, stop, unmatched, ambiguous
}

enum NativeVoiceRules {
    static func ownerIdentity(account: String, profileID: String, email: String, verified: Bool) -> Bool {
        !account.isEmpty && account == profileID && verified
            && email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "atmosphere9999@gmail.com"
    }

    static let playbackRate: Float = 1.05
    static let destinations = ["today", "bible", "chat", "connections", "study", "notes", "settings"]

    static func normalized(_ text: String) -> String {
        text.decomposedStringWithCompatibilityMapping.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US"))
            .replacingOccurrences(of: "&", with: " and ")
            .replacingOccurrences(of: "[^a-z0-9\\s]", with: " ", options: .regularExpression)
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    static func resolve(_ text: String, options: [String]) -> NativeVoiceCommand {
        guard text.count <= 1024 else { return .unmatched }
        if text.range(of: #"(?:^|\s)-\s*\d"#, options: .regularExpression) != nil { return .ambiguous }
        let value = normalized(text).replacingOccurrences(of: #"^please | please$"#, with: "", options: .regularExpression)
        guard !value.isEmpty else { return .unmatched }
        let prefixes = ["choose ", "select ", "pick "]
        let label = (prefixes.first(where: value.hasPrefix).map { String(value.dropFirst($0.count)) } ?? value)
            .replacingOccurrences(of: #"^the "#, with: "", options: .regularExpression)
        let candidate = label.replacingOccurrences(of: #"^(i am|i m|im) "#, with: "", options: .regularExpression)
        let matches = options.filter { normalized($0) == value || normalized($0) == label || normalized($0) == candidate }
        if matches.count > 1 { return .ambiguous }
        if let match = matches.first { return .choose(match) }
        if ["stop", "stop voice", "cancel", "cancel voice", "stop listening", "end voice control", "end voice controls", "turn voice off", "end voice", "stop voice control", "stop voice controls"].contains(value) { return .stop }
        if ["back", "go back", "take me back"].contains(value) { return .back }
        if ["repeat", "repeat options", "read options", "read the options", "repeat the options", "read my options", "what are my choices", "repeat that", "read choices", "read my choices", "read the choices", "what are the choices", "what are the options", "repeat my options", "repeat my choices", "repeat the choices", "say that again"].contains(value) { return .repeatOptions }
        let aliases = ["home": "today", "daily walk": "today", "reader": "bible", "bible reader": "bible",
                       "conversations": "chat", "my conversations": "chat", "bible connections": "connections",
                       "study tools": "study", "my notes": "notes", "preferences": "settings"]
        for phrase in ["open ", "go to ", "take me to ", "show me ", "navigate to ", "switch to "] where value.hasPrefix(phrase) {
            let raw = String(value.dropFirst(phrase.count)).replacingOccurrences(of: #"^the "#, with: "", options: .regularExpression)
            if destinations.contains(raw) { return .navigate(raw) }
            if let destination = aliases[raw] { return .navigate(destination) }
        }
        let ordinals = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
                        "twenty one", "twenty two", "twenty three", "twenty four", "twenty five", "twenty six", "twenty seven", "twenty eight", "twenty nine", "thirty"]
        let ordinalNames = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
                            "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth",
                            "twenty first", "twenty second", "twenty third", "twenty fourth", "twenty fifth", "twenty sixth", "twenty seventh", "twenty eighth", "twenty ninth", "thirtieth"]
        let number = label.replacingOccurrences(of: "the ", with: "")
            .replacingOccurrences(of: "option number ", with: "").replacingOccurrences(of: "option ", with: "").replacingOccurrences(of: "number ", with: "")
            .replacingOccurrences(of: " choice", with: "").replacingOccurrences(of: " option", with: "").replacingOccurrences(of: #" one$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"(?<=[0-9])(st|nd|rd|th)$"#, with: "", options: .regularExpression)
        let index = Int(number).map { $0 - 1 } ?? ordinals.firstIndex(of: number) ?? ordinalNames.firstIndex(of: number)
        if let index {
            guard options.indices.contains(index) else { return .ambiguous }
            return .choose(options[index])
        }
        // A shortened label or an attempted numbered selection is a retry,
        // never free text silently sent as an answer.
        if options.contains(where: { normalized($0).contains(label) || label.contains(normalized($0)) })
            || prefixes.contains(where: value.hasPrefix) || value.hasPrefix("option ") { return .ambiguous }
        return .unmatched
    }

    static func spotlightOptions(_ request: SpotlightRequest) -> [String] {
        request.stop == nil ? ["Done"] : [request.isLastStop ? "Done" : "Next", "Stop"]
    }

    static func optionsText(_ card: OnboardingChoiceCard, options: [String]? = nil) -> String {
        let choices = (options ?? (card.options + [card.skipLabel])).enumerated().map { "Option \($0.offset + 1). \($0.element)." }.joined(separator: " ")
        return "\(card.question) \(choices) Say the full answer or its option number. You can also say open Bible, go back, repeat options, or stop voice."
    }

    static func canListen(enabled: Bool, foreground: Bool, busy: Bool, narrating: Bool, saved: Bool) -> Bool {
        enabled && foreground && !busy && !narrating && saved
    }

    static func latestSavedMessageMatches(_ message: ChatViewMessage, rows: [JSONValue]) -> Bool {
        guard let row = rows.last, let stored = UIMessage(storedRow: row) else { return false }
        let view = ChatViewMessage(message: stored, isStreaming: false)
        return view.role == .assistant && view.id == message.id && view.content == message.content
            && view.choiceCard == message.choiceCard
    }

    static func authorized(status: Int, value: JSONValue?) -> Bool {
        // GET performs the verified-primary-email owner check on the server.
        // `available` concerns the paid relay; local Apple speech uses no relay.
        status == 200 && value?["pro"]?.boolValue == true
    }
}
