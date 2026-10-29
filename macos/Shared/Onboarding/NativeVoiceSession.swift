import Foundation

/// One account's local speech controls. No relay session or alternate chat
/// history: all answers enter the existing tap/send paths.
@MainActor
@Observable
final class NativeVoiceSession {
    let input = NativeVoiceInput()
    private(set) var waitingForSave = false
    private(set) var handling = false
    private(set) var isStarting = false
    @ObservationIgnored private var lifecycle = UUID()
    @ObservationIgnored private var verification: Task<Void, Never>?
    @ObservationIgnored private var verifyingKey: String?
    @ObservationIgnored private var savedKey: String?
    @ObservationIgnored private var spokenKey: String?
    @ObservationIgnored private var previous: [(AppSection, Bool)] = []
    @ObservationIgnored private var foreground = true
    @ObservationIgnored private var spokenSpotlightID: UUID?
    @ObservationIgnored private var captureContext: String?
    @ObservationIgnored private var operation: Task<Void, Never>?

    func activeCard(app: AppModel) -> (ChatViewMessage, OnboardingChoiceCard)? {
        guard app.section == .chat, !app.isSettingsPresented,
              let message = app.chat.messages.last, let card = message.choiceCard,
              app.onboarding.cardStates(for: app.chat)[message.id]?.active == true else { return nil }
        return (message, card)
    }

    private func options(for message: ChatViewMessage, card: OnboardingChoiceCard, app: AppModel) -> [String] {
        if card.step == .dailyTime, app.onboarding.hourPickerMessageID == message.id {
            return OnboardingRules.pickableHours.map(OnboardingRules.hourLabel) + [card.skipLabel]
        }
        return card.options + [card.skipLabel]
    }

    private func optionsText(_ active: (ChatViewMessage, OnboardingChoiceCard), app: AppModel) -> String {
        NativeVoiceRules.optionsText(active.1, options: options(for: active.0, card: active.1, app: app))
    }

    private func voiceOptions(app: AppModel) -> [String] {
        if let spotlight = app.onboarding.spotlight { return NativeVoiceRules.spotlightOptions(spotlight) }
        return activeCard(app: app).map { self.options(for: $0.0, card: $0.1, app: app) } ?? []
    }

    private func spotlightText(_ spotlight: SpotlightRequest) -> String {
        let labels = NativeVoiceRules.spotlightOptions(spotlight).enumerated().map { "Option \($0.offset + 1). \($0.element)." }.joined(separator: " ")
        return "\(spotlight.caption) \(labels) Say the full label or its option number."
    }

    private func key(app: AppModel) -> String {
        "\(app.chat.activeConversationID ?? "new"):\(app.chat.messages.last?.id ?? "empty")"
    }

    func setForeground(_ active: Bool, app: AppModel, permissionPrompt: Bool = false) {
        foreground = active
        if active { synchronize(app: app) }
        else if permissionPrompt, isStarting, input.isPreparing {
            // A system permission dialog makes the scene inactive. There is
            // no microphone yet; keep its permission continuation alive.
            return
        } else { stop(app: app) }
    }

    func start(app: AppModel) async {
        guard !isStarting, !input.isEnabled else { return }
        let current = UUID()
        lifecycle = current
        isStarting = true
        defer { if lifecycle == current { isStarting = false } }
        await input.checkEligibility(api: app.api, account: app.userID)
        guard lifecycle == current, !Task.isCancelled else { return }
        guard input.isEligible else {
            app.onboarding.voice.enqueueLocal("Voice controls are unavailable for this account right now.")
            return
        }
        await input.enable()
        guard lifecycle == current, !Task.isCancelled else { return }
        guard input.isEnabled else {
            app.onboarding.voice.enqueueLocal(input.status)
            return
        }
        app.onboarding.voice.stop()
        spokenKey = nil
        input.onFailure = { [weak app] message in app?.onboarding.voice.enqueueLocal(message) }
        input.onIdle = { [weak self, weak app] in
            guard let self, let app else { return }
            self.synchronize(app: app)
        }
        input.onFinal = { [weak self, weak app] text in
            guard let self, let app else { return }
            self.handle(text, app: app)
        }
        app.onboarding.voice.enqueueLocal("Voice controls on. Say open Bible to navigate, repeat options to hear your choices, or stop voice to finish.")
        synchronize(app: app)
    }

    func teardown() {
        lifecycle = UUID(); isStarting = false
        verification?.cancel(); verification = nil
        operation?.cancel(); operation = nil
        verifyingKey = nil; savedKey = nil; spokenKey = nil
        spokenSpotlightID = nil; captureContext = nil; previous = []
        waitingForSave = false; handling = false
        input.onFinal = nil; input.onFailure = nil; input.onIdle = nil
        input.stop()
    }

    func stop(app: AppModel) {
        teardown()
        app.onboarding.voice.stop()
    }

    func synchronize(app: AppModel) {
        guard input.isEnabled else { return }
        let busy = app.chat.isBusy || app.chat.historyLoading || app.chat.uploadingAttachments || app.chat.isCreatingConversation || app.onboarding.isSendingAnswer || handling || isStarting
            || app.dailyCross.listen.isPlaying || app.chapterAudio.isPlaying
            || app.aiConsent.prompt != nil || !app.aiConsent.isCurrent || app.onboarding.isSpotlightTransitioning
        if app.chat.sendError != nil, !app.chat.isBusy {
            input.fail("The answer could not be completed. Use Try again in Chat, then start voice controls again.")
            return
        }
        let current = key(app: app)
        let context = "\(current):\(app.section.rawValue):\(app.isSettingsPresented):\(activeCard(app: app)?.0.id ?? "none"):\(app.onboarding.hourPickerMessageID ?? "closed"):\(app.onboarding.spotlight?.id.uuidString ?? "none")"
        if captureContext != context { input.wait(); captureContext = context }
        if busy || !foreground {
            input.wait()
            verification?.cancel(); verification = nil; verifyingKey = nil
            savedKey = nil; waitingForSave = false
            return
        }
        // A completed HTTP stream is not proof that its DB save has finished.
        // Match the latest stored assistant (including the card) before TTS or
        // another capture. Never let a delayed request unlock a different chat.
        if savedKey != current, let message = app.chat.messages.last, message.role == .assistant {
            input.wait("Waiting for the answer to be saved.")
            guard verifyingKey != current else { return }
            verifyingKey = current; waitingForSave = true
            verification = Task { [weak self, weak app] in
                guard let self, let app else { return }
                var saved = false
                for attempt in 0..<8 {
                    if attempt > 0 { try? await Task.sleep(for: .milliseconds(750)) }
                    guard !Task.isCancelled, self.input.isEnabled, self.key(app: app) == current,
                          let id = app.chat.activeConversationID else { return }
                    if let payload = try? await app.api.json("/api/conversations/\(id)", as: JSONValue.self),
                       let rows = payload["messages"]?.arrayValue {
                        saved = NativeVoiceRules.latestSavedMessageMatches(message, rows: rows)
                    }
                    if saved { break }
                }
                guard !Task.isCancelled, self.key(app: app) == current else { return }
                self.verification = nil; self.verifyingKey = nil; self.waitingForSave = false
                guard saved else {
                    self.input.fail("The answer is not confirmed saved yet. Start voice controls to retry.")
                    return
                }
                self.savedKey = current
                self.synchronize(app: app)
            }
            return
        }
        if spokenKey != current, let message = app.chat.messages.last, message.role == .assistant {
            input.wait()
            spokenKey = current
            var text = message.content
            if let active = activeCard(app: app) { text += " " + optionsText(active, app: app) }
            app.onboarding.voice.enqueueLocal(text)
        }
        if let spotlight = app.onboarding.spotlight, spokenSpotlightID != spotlight.id {
            input.wait()
            spokenSpotlightID = spotlight.id
            app.onboarding.voice.enqueueLocal(spotlightText(spotlight))
        }
        let canListen = NativeVoiceRules.canListen(enabled: input.isEnabled, foreground: foreground,
            busy: busy || waitingForSave, narrating: app.onboarding.voice.isBusy,
            saved: savedKey == current || app.chat.messages.isEmpty)
        if canListen {
            let options = voiceOptions(app: app)
            input.listen(context: options + NativeVoiceRules.destinations.map { "open \($0)" })
        } else { input.wait() }
    }

    private func navigate(section: AppSection, settings: Bool, pushHistory: Bool, app: AppModel) {
        handling = true
        operation = Task { [weak self, weak app] in
            guard let self, let app else { return }
            let canLeave = await app.noteDeparture.canLeave()
            guard !Task.isCancelled, self.input.isEnabled else { return }
            defer { self.handling = false; self.synchronize(app: app) }
            guard canLeave else {
                app.onboarding.voice.enqueueLocal("Your note could not be saved, so I kept you here. Please check the note before changing screens.")
                return
            }
            if pushHistory { self.previous.append((app.section, app.isSettingsPresented)) }
            else { _ = self.previous.popLast() }
            if section == .notes { app.pendingStudyDestination = .notes }
            app.section = section
            app.isSettingsPresented = settings
            app.onboarding.voice.enqueueLocal("Opening \(settings ? "Settings" : section.title).")
        }
    }

    private func handle(_ text: String, app: AppModel) {
        guard input.isEnabled, foreground, !app.chat.isBusy, !handling, !isStarting,
              !app.chat.historyLoading, !app.chat.uploadingAttachments, !app.chat.isCreatingConversation,
              !app.onboarding.voice.isBusy, !app.onboarding.isSendingAnswer,
              !app.dailyCross.listen.isPlaying, !app.chapterAudio.isPlaying else { return }
        let expected = "\(key(app: app)):\(app.section.rawValue):\(app.isSettingsPresented):\(activeCard(app: app)?.0.id ?? "none"):\(app.onboarding.hourPickerMessageID ?? "closed"):\(app.onboarding.spotlight?.id.uuidString ?? "none")"
        guard captureContext == expected else { synchronize(app: app); return }
        let card = activeCard(app: app)
        let options = voiceOptions(app: app)
        switch NativeVoiceRules.resolve(text, options: options) {
        case .stop:
            stop(app: app)
            app.onboarding.voice.enqueueLocal("Voice controls off.")
        case .repeatOptions:
            app.onboarding.voice.enqueueLocal(app.onboarding.spotlight.map(spotlightText) ?? card.map { optionsText($0, app: app) }
                ?? "There are no active choices here. Say open Today, Bible, Chat, Connections, Study, Notes or Settings, or go back.")
        case .navigate(let destination):
            let section = AppSection(rawValue: destination) ?? app.section
            navigate(section: section, settings: destination == "settings", pushHistory: true, app: app)
        case .back:
            if let prior = previous.last {
                navigate(section: prior.0, settings: prior.1, pushHistory: false, app: app)
            } else { app.onboarding.voice.enqueueLocal("There is no previous voice destination.") }
        case .choose(let label):
            if let spotlight = app.onboarding.spotlight {
                guard NativeVoiceRules.spotlightOptions(spotlight).contains(label) else { return }
                if label == "Stop" { app.onboarding.closeSpotlight() }
                else { app.onboarding.advanceSpotlight(app: app) }
                break
            }
            guard let (message, card) = card else { return }
            // Opening the same picker as a tap is not an answer. Its hours
            // become the current voice options until one is actually chosen.
            if card.step == .dailyTime && label == OnboardingRules.pickATime {
                app.onboarding.setHourPicker(messageID: message.id, open: true)
                app.onboarding.voice.enqueueLocal(optionsText((message, card), app: app))
            } else {
                app.onboarding.voice.enqueueLocal("Choosing \(label).")
                app.onboarding.answer(card, with: label, messageID: message.id, app: app)
            }
        case .ambiguous:
            app.onboarding.voice.enqueueLocal("Please say one full answer or a single option number. Say repeat options to hear the choices.")
        case .unmatched:
            guard app.section == .chat, !app.isSettingsPresented,
                  card == nil || card?.1.allowOther == true,
                  app.chat.fileAttachments.isEmpty, app.chat.attachment == nil, !app.chat.isEditing else {
                app.onboarding.voice.enqueueLocal("I did not recognize a command. Say a full option, open Chat, repeat options, or stop voice.")
                break
            }
            handling = true
            app.onboarding.voice.enqueueLocal("I am working on your answer.")
            operation = Task { [weak self, weak app] in
                guard let self, let app, !Task.isCancelled else { return }
                let draft = app.chat.input
                app.chat.input = text
                await app.chat.send()
                if app.chat.input.isEmpty || app.chat.input == text { app.chat.input = draft }
                self.handling = false
                self.synchronize(app: app)
            }
        }
        synchronize(app: app)
    }
}
