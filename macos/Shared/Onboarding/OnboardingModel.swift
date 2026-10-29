import Foundation
import SwiftUI

/// What `POST /api/onboarding/start` answers.
enum OnboardingStartResult: Equatable, Sendable {
    case active(conversationID: String, created: Bool)
    case done
    case notEligible

    init?(_ value: JSONValue) {
        switch value["status"]?.stringValue {
        case "active":
            guard let id = value["conversationId"]?.stringValue, !id.isEmpty else { return nil }
            self = .active(conversationID: id, created: value["created"]?.boolValue == true)
        case "done": self = .done
        case "not_eligible": self = .notEligible
        default: return nil
        }
    }
}

/// `GET /api/onboarding/progress`: whether the Getting started card shows,
/// and which rows real use has ticked.
struct GettingStartedProgress: Equatable, Sendable {
    var show: Bool
    var items: [GettingStartedKey: Bool]

    init(show: Bool, items: [GettingStartedKey: Bool]) {
        self.show = show
        self.items = items
    }

    init?(_ value: JSONValue) {
        guard let show = value["show"]?.boolValue else { return nil }
        var items: [GettingStartedKey: Bool] = [:]
        for key in GettingStartedKey.allCases {
            items[key] = value["items"]?[key.rawValue]?.boolValue == true
        }
        self.init(show: show, items: items)
    }

    var allDone: Bool { GettingStartedKey.allCases.allSatisfy { items[$0] == true } }
}

/// One lit place on screen: the target, SureWord's sentence for it, and where
/// it sits in a tour.
struct SpotlightRequest: Equatable, Identifiable {
    let id = UUID()
    var target: AppTarget
    var caption: String
    /// Zero-based stop and stop count while a tour plays; nil for a single "Show me".
    var stop: Int?
    var stopCount: Int?

    var isLastStop: Bool { stop.map { $0 + 1 >= (stopCount ?? 0) } ?? true }
}

/// "Walk with me" for one signed-in account (docs/onboarding/PLAN.md): the
/// automatic start after sign-in, the card actions, the spotlight and the
/// tour, the "?" help buttons, the Getting started card and voice mode.
///
/// The server owns the conversation; this model only starts it, answers its
/// cards the way a tap would, and moves around the app. Navigation goes
/// through `AppModel` (`section`, `pendingVerseReference`,
/// `isSettingsPresented`), the same doors every other deep link uses.
@MainActor
@Observable
final class OnboardingModel {
    private let api: APIClient
    private let account: String?
    let voice: OnboardingVoice
    let voiceControls = NativeVoiceSession()
    private(set) var isSendingAnswer = false
    private(set) var hourPickerMessageID: String?

    func setHourPicker(messageID: String, open: Bool) {
        hourPickerMessageID = open ? messageID : nil
    }

    /// The welcome conversation, once `start` has named it this session.
    private(set) var welcomeConversationID: String?
    private(set) var isStarting = false
    private(set) var startError: String?
    /// Cards answered from this device, keyed by message id, so a tap disables
    /// the buttons before the user message lands.
    private(set) var answered: [String: String] = [:]
    private(set) var progress: GettingStartedProgress?
    private(set) var spotlight: SpotlightRequest?
    private(set) var isSpotlightTransitioning = false
    /// Set while a spotlight's place is on screen, by the host that drew it.
    @ObservationIgnored private var confirmedSpotlight: UUID?
    @ObservationIgnored private var tourStops: [TourStop] = []
    /// The tour stop last asked for, for the tour event's `stops_seen`.
    @ObservationIgnored private var tourStopIndex = 0
    @ObservationIgnored private var spotlightTask: Task<Void, Never>?
    @ObservationIgnored private var autoStartAttempted = false

    /// Bumped to ask the open composer to take focus ("Type my own").
    private(set) var composerFocusRequest = 0
    /// Sections whose stack must go back to its root before one of their
    /// cards is lit. Each section consumes its own entry, mounted or not.
    private(set) var pendingRootReset: Set<AppSection> = []
    /// The verse row the reader registers as `reader.verse`, while one is lit.
    private(set) var spotlightVerse: Int?
    /// The Settings place a spotlight is waiting for (the Mac picks its pane
    /// from this; iOS opens the hub, where both rows live).
    private(set) var pendingSettingsTarget: AppTarget?

    init(api: APIClient, account: String?) {
        self.api = api
        self.account = account
        voice = OnboardingVoice(api: api)
    }

    // MARK: Start

    private var finishedKey: String? { account.map { "onboarding.autoStart.settled.\($0)" } }

    /// The automatic start, once per session and only for an account the
    /// server has not already answered "done" or "not eligible" for. Runs
    /// once the AI consent sheet is settled (agreed, and nothing on screen).
    func autoStartIfNeeded(consentSettled: Bool, app: AppModel) async {
        guard consentSettled, !autoStartAttempted, account != nil else { return }
        if let finishedKey, UserDefaults.standard.bool(forKey: finishedKey) { return }
        autoStartAttempted = true
        guard let result = await start(.auto) else {
            // A failed request is retried on the next launch.
            return
        }
        switch result {
        case .active(let id, _):
            open(conversationID: id, app: app)
        case .done, .notEligible:
            if let finishedKey { UserDefaults.standard.set(true, forKey: finishedKey) }
        }
    }

    /// "Walk me through SureWord" in Settings: always answers a conversation
    /// for a signed-in account, picked up where it was left.
    func startManually(app: AppModel) async {
        guard let result = await start(.manual) else { return }
        if case .active(let id, _) = result {
            app.isSettingsPresented = false
            open(conversationID: id, app: app)
        }
    }

    enum StartMode: String { case auto, manual }

    private func start(_ mode: StartMode) async -> OnboardingStartResult? {
        guard !isStarting else { return nil }
        isStarting = true
        startError = nil
        defer { isStarting = false }
        struct Body: Encodable { let mode: String }
        do {
            let value = try await api.json(
                "/api/onboarding/start", method: "POST", body: Body(mode: mode.rawValue), as: JSONValue.self
            )
            let result = OnboardingStartResult(value)
            if result == nil { startError = "Walk with me could not start. Please try again." }
            return result
        } catch {
            startError = "Walk with me could not start. Please try again."
            return nil
        }
    }

    private func open(conversationID: String, app: AppModel) {
        welcomeConversationID = conversationID
        app.section = .chat
        Task { await app.chat.switchConversation(to: conversationID) }
    }

    /// True for the welcome conversation: the one `start` named, or one whose
    /// seeded first message carries the welcome card.
    func isWelcome(_ chat: ChatViewModel) -> Bool {
        if let welcomeConversationID, chat.activeConversationID == welcomeConversationID { return true }
        return chat.messages.first?.isWelcome == true
    }

    // MARK: Cards

    /// A card's buttons take a tap only while it is the newest card, nothing
    /// is streaming, and this device has not already answered it.
    func cardStates(for chat: ChatViewModel) -> [String: OnboardingRules.CardState] {
        var states = OnboardingRules.cardStates(chat.messages, busy: chat.isBusy)
        for (id, label) in answered where states[id] != nil {
            states[id]?.active = false
            if states[id]?.answer == nil { states[id]?.answer = label }
        }
        return states
    }

    /// Do the step's device action, then send the label as the reader's
    /// answer through the ordinary send path.
    func answer(_ card: OnboardingChoiceCard, with label: String, messageID: String, app: AppModel) {
        guard answered[messageID] == nil,
              cardStates(for: app.chat)[messageID]?.active == true else { return }
        voiceControls.input.wait()
        isSendingAnswer = true
        answered[messageID] = label
        hourPickerMessageID = nil
        Analytics.shared.track(AnalyticsEvents.onboardingStep, [
            "step": .string(card.step.rawValue),
            "outcome": .string(label == card.skipLabel ? "skipped" : "answered"),
        ])
        switch card.step {
        case .textScale:
            if let scale = TextScale(label: label) { app.settings.textScale = scale }
        case .dailyTime:
            if let hour = OnboardingRules.hour(forLabel: label) {
                app.settings.verseOfDayHour = hour
                app.settings.verseOfDayEnabled = true
                NotificationPermissionMoments.shared.signal(.settingsEnabled)
            }
        default:
            break
        }
        let startsTour = card.step == .tour && label == OnboardingRules.showMeAround
        Task {
            await send(label, chat: app.chat)
            isSendingAnswer = false
            if startsTour { startTour(OnboardingRules.tourStops, app: app) }
        }
    }

    /// "Talk with SureWord about this" from a glossary sheet: their question
    /// answers the card, so SureWord explains and asks the step again.
    func ask(_ question: String, card: OnboardingChoiceCard, messageID: String, app: AppModel) {
        guard answered[messageID] == nil else { return }
        answered[messageID] = question
        Analytics.shared.track(AnalyticsEvents.onboardingStep, [
            "step": .string(card.step.rawValue), "outcome": "asked",
        ])
        Task { await send(question, chat: app.chat) }
    }

    /// "Type my own": put the cursor in the composer. Counted as `own`, as
    /// web does, since the typed reply is an ordinary message.
    func typeOwn(_ card: OnboardingChoiceCard) {
        Analytics.shared.track(AnalyticsEvents.onboardingStep, [
            "step": .string(card.step.rawValue), "outcome": "own",
        ])
        focusComposer()
    }

    func focusComposer() {
        composerFocusRequest &+= 1
    }

    /// Send text as if typed, keeping whatever draft was in the composer.
    private func send(_ text: String, chat: ChatViewModel) async {
        let draft = chat.input
        chat.input = text
        await chat.send()
        if chat.input.isEmpty, draft != text { chat.input = draft }
    }

    // MARK: Help

    /// A "?" button: a new chat on the Chat tab, asking about this screen.
    func help(_ screen: HelpScreen, app: AppModel) {
        app.isSettingsPresented = false
        app.section = .chat
        app.chat.newConversation()
        Task { await send(screen.message, chat: app.chat) }
    }

    // MARK: Spotlight

    /// A "Show me" card: the whole tour, or one place.
    func show(_ card: ShowInAppCard, app: AppModel) {
        if card.target == .tour {
            startTour(card.stops.isEmpty ? OnboardingRules.tourStops : card.stops, app: app)
        } else {
            closeSpotlight()
            light(card.target, caption: card.caption, stop: nil, app: app)
        }
    }

    /// A Getting started row: its place, with its label as the caption.
    func show(_ item: GettingStartedItem, app: AppModel) {
        show(ShowInAppCard(target: item.target, caption: item.label), app: app)
    }

    func startTour(_ stops: [TourStop], app: AppModel) {
        let playable = stops.filter { $0.target != .tour }
        guard let first = playable.first else { return }
        closeSpotlight()
        tourStops = playable
        Analytics.shared.track(AnalyticsEvents.onboardingTour, [
            "stage": "started", "stops_seen": 0, "stops": .int(playable.count),
        ])
        light(first.target, caption: first.caption, stop: 0, app: app)
    }

    /// Next on a tour stop, or Done on the last (or on a single spotlight).
    func advanceSpotlight(app: AppModel) {
        guard let current = spotlight, let index = current.stop, index + 1 < tourStops.count else {
            closeSpotlight(completed: true)
            return
        }
        let next = tourStops[index + 1]
        light(next.target, caption: next.caption, stop: index + 1, app: app)
    }

    /// `completed` is Done on the tour's last stop (or the verse it ends on
    /// being tapped); anything else on a tour counts as leaving it early.
    func closeSpotlight(completed: Bool = false) {
        if !tourStops.isEmpty {
            Analytics.shared.track(AnalyticsEvents.onboardingTour, [
                "stage": .string(completed ? "finished" : "left"),
                "stops_seen": .int(tourStopIndex + 1),
                "stops": .int(tourStops.count),
            ])
        }
        spotlightTask?.cancel()
        spotlightTask = nil
        spotlight = nil
        isSpotlightTransitioning = false
        tourStops = []
        spotlightVerse = nil
        pendingSettingsTarget = nil
        confirmedSpotlight = nil
    }

    /// Called by the host that drew the spotlight, so the timeout knows the
    /// place exists on this screen.
    func spotlightAppeared(_ id: UUID) {
        confirmedSpotlight = id
    }

    /// Settings consumed `pendingSettingsTarget` (the Mac switched panes).
    func consumeSettingsTarget() {
        pendingSettingsTarget = nil
    }

    /// Long enough for a tab switch, a pushed reader or a presented sheet to
    /// lay out before the place is looked for.
    private static let settleDelay: Duration = .milliseconds(450)
    /// A place that has not been drawn by then is not on this client; skip it.
    private static let missingTimeout: Duration = .milliseconds(1600)

    private func light(_ target: AppTarget, caption: String, stop: Int?, app: AppModel) {
        spotlightTask?.cancel()
        spotlight = nil
        isSpotlightTransitioning = true
        confirmedSpotlight = nil
        if let stop { tourStopIndex = stop }
        navigate(to: target, app: app)
        let request = SpotlightRequest(
            target: target,
            caption: caption,
            stop: stop,
            stopCount: stop == nil ? nil : tourStops.count
        )
        spotlightTask = Task { [weak self] in
            try? await Task.sleep(for: Self.settleDelay)
            guard !Task.isCancelled, let self else { return }
            self.spotlight = request
            self.isSpotlightTransitioning = false
            try? await Task.sleep(for: Self.missingTimeout)
            guard !Task.isCancelled, self.spotlight?.id == request.id,
                  self.confirmedSpotlight != request.id
            else { return }
            // Unregistered on this client (the Apple composer has no
            // microphone, for one): move on without a word.
            self.advanceSpotlight(app: app)
        }
    }

    private func navigate(to target: AppTarget, app: AppModel) {
        spotlightVerse = nil
        if target.isSettings {
            pendingSettingsTarget = target
            app.isSettingsPresented = true
            return
        }
        pendingSettingsTarget = nil
        app.isSettingsPresented = false
        guard let section = target.section else { return }
        if target == .readerVerse {
            spotlightVerse = OnboardingRules.tourVerseNumber
            app.pendingVerseReference = OnboardingRules.tourVerseReference
        } else if section == .today || section == .study {
            pendingRootReset.insert(section)
        }
        app.section = section
    }

    /// True once per request: the section pops to its root when it sees it.
    func consumeRootReset(_ section: AppSection) -> Bool {
        pendingRootReset.remove(section) != nil
    }

    // MARK: Getting started

    func loadProgress() async {
        guard let value = try? await api.json("/api/onboarding/progress", as: JSONValue.self),
              let progress = GettingStartedProgress(value)
        else { return }
        self.progress = progress
    }

    /// The card's X. Hidden at once; the server remembers it for every client.
    func dismissGettingStarted() async {
        progress?.show = false
        struct Body: Encodable { let dismissed: Bool }
        if let value = try? await api.json(
            "/api/onboarding/progress", method: "PATCH", body: Body(dismissed: true), as: JSONValue.self
        ), let progress = GettingStartedProgress(value) {
            self.progress = progress
        }
    }

    // MARK: Session end

    func teardown() {
        closeSpotlight()
        voiceControls.teardown()
        voice.stop()
    }
}

extension OnboardingRules {
    /// "7 am", "Noon", "7 pm": the label a reminder hour chip shows and sends.
    static func hourLabel(_ hour: Int) -> String {
        if hour == 12 { return "Noon" }
        if hour == 0 { return "12 am" }
        return hour < 12 ? "\(hour) am" : "\(hour - 12) pm"
    }

    /// The local hour a daily time answer means, or nil for "Not now" and
    /// anything typed.
    static func hour(forLabel label: String) -> Int? {
        if let hour = dailyTimeHours[label] { return hour }
        guard let match = label.wholeMatch(of: /(\d{1,2}) (am|pm)/), let value = Int(match.1),
              (1...12).contains(value)
        else { return nil }
        if match.2 == "am" { return value == 12 ? 0 : value }
        return value == 12 ? 12 : value + 12
    }

    /// Every local hour, in the same order for touch and numbered voice choices.
    static let pickableHours = Array(0...23)
}
