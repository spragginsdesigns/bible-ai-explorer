import SwiftUI

/// Big enough for any thumb and any eyes (docs/onboarding/PLAN.md: at least 56pt).
private let minTapHeight: CGFloat = 56

/// Walk with me's cards under one of SureWord's messages: the tap-to-answer
/// choice card, then a "Show me" card per showInApp part. Drawn by both chat
/// bubbles, below the receipts line. The port of
/// `mobile/src/features/onboarding/ChoiceCard.tsx` and `ShowMeCard.tsx`.
struct GuideMessageCards: View {
    @Environment(AppModel.self) private var app
    let message: ChatViewMessage
    /// Nil for a message with no choice card.
    let state: OnboardingRules.CardState?

    var body: some View {
        if let card = message.choiceCard, !message.isStreaming {
            GuideChoiceCard(
                card: card,
                isActive: state?.active == true,
                chosen: state?.answer,
                answer: { label in app.onboarding.answer(card, with: label, messageID: message.id, app: app) },
                typeOwn: { app.onboarding.typeOwn(card) }
            )
        }
        if !message.isStreaming {
            ForEach(Array(message.showMe.enumerated()), id: \.offset) { _, card in
                GuideShowMeCard(card: card) { app.onboarding.show(card, app: app) }
            }
        }
    }
}

/// The question, full-width answers, "Type my own" and "Speak" when the step
/// takes free text, and a quiet way past it. Only the newest card is live; an
/// answered one stays as a record of the question and cannot be tapped again.
struct GuideChoiceCard: View {
    @Environment(\.theme) private var theme
    @Environment(\.textScaleFactor) private var textScale
    let card: OnboardingChoiceCard
    let isActive: Bool
    /// What the reader replied, so an answered card shows which option it was.
    var chosen: String? = nil
    let answer: (String) -> Void
    let typeOwn: () -> Void

    @State private var pickingHour = false
    @State private var speakHint = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(card.question)
                .font(.system(size: 17 * textScale, weight: .semibold))
                .foregroundStyle(theme.text)
                .fixedSize(horizontal: false, vertical: true)

            if card.step == .church, isActive {
                GuideChurchStep { name in answer("I saved \(name) as my home church.") }
            }

            VStack(spacing: Spacing.sm) {
                ForEach(card.options, id: \.self) { option in
                    if card.step == .dailyTime, option == OnboardingRules.pickATime {
                        optionButton(option) { pickingHour.toggle() }
                    } else {
                        optionButton(option, preview: card.step == .textScale ? TextScale(label: option) : nil) {
                            answer(option)
                        }
                    }
                }
            }

            if pickingHour, isActive {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.sm) {
                        ForEach(OnboardingRules.pickableHours, id: \.self) { hour in
                            Button {
                                answer(OnboardingRules.hourLabel(hour))
                            } label: {
                                Text(OnboardingRules.hourLabel(hour))
                                    .font(.system(size: 16 * textScale))
                                    .foregroundStyle(theme.text)
                                    .frame(minWidth: 76, minHeight: minTapHeight)
                                    .padding(.horizontal, Spacing.sm)
                                    .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                                    .overlay {
                                        RoundedRectangle(cornerRadius: Radius.md)
                                            .strokeBorder(theme.accentBorder, lineWidth: 1)
                                    }
                                    .contentShape(.rect(cornerRadius: Radius.md))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                }
            }

            if isActive { footer }

            if speakHint, isActive {
                Text(Self.speakHint)
                    .font(.system(size: 13 * textScale))
                    .foregroundStyle(theme.textSecondary)
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.accentBorder, lineWidth: 1)
        }
    }

    /// Neither Apple composer has a microphone of its own; the system's
    /// dictation is one key away from the focused composer.
    #if os(iOS)
    private static let speakHint = "Tap the microphone on your keyboard and say your answer."
    #else
    private static let speakHint = "Press the dictation key (or Fn twice) and say your answer."
    #endif

    private var footer: some View {
        HStack(spacing: Spacing.sm) {
            if card.allowOther {
                footerButton("Type my own", systemImage: "square.and.pencil") {
                    speakHint = false
                    typeOwn()
                }
                footerButton("Speak", systemImage: "mic") {
                    speakHint = true
                    typeOwn()
                }
                .accessibilityLabel("Answer by speaking")
            }
            Spacer(minLength: Spacing.sm)
            Button {
                answer(card.skipLabel)
            } label: {
                Text(card.skipLabel)
                    .font(.system(size: 14 * textScale))
                    .foregroundStyle(theme.textSecondary)
                    .frame(minHeight: 44)
            }
            .buttonStyle(SubtleButtonStyle())
        }
    }

    private func footerButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 15 * textScale))
                .foregroundStyle(theme.accent)
                .frame(minHeight: 44)
        }
        .buttonStyle(SubtleButtonStyle())
    }

    /// Each text size previews itself, so the choice is made by looking. The
    /// preview replaces the current factor rather than stacking on it.
    private func optionButton(_ label: String, preview: TextScale? = nil, action: @escaping () -> Void) -> some View {
        let size: CGFloat = 17 * (preview?.factor ?? textScale)
        let isChosen = !isActive && chosen == label
        return Button(action: action) {
            HStack(spacing: Spacing.sm) {
                Text(label)
                    .font(.system(size: size, weight: .medium))
                    .foregroundStyle(theme.text)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if isChosen {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15 * textScale, weight: .semibold))
                        .foregroundStyle(theme.accent)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: minTapHeight)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.xs)
            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(isChosen ? theme.accent : theme.accentBorder, lineWidth: isChosen ? 1.5 : 1)
            }
            .contentShape(.rect(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
        .disabled(!isActive)
        .opacity(isActive || isChosen ? 1 : 0.55)
        .accessibilityValue(isChosen ? "Your answer" : "")
    }
}

/// The church step: search inline with the same model Settings uses, and
/// answer for the reader as soon as a church is saved.
private struct GuideChurchStep: View {
    @Environment(\.theme) private var theme
    @Environment(\.textScaleFactor) private var textScale
    @Environment(AppModel.self) private var app
    let onSaved: (String) -> Void

    @State private var model = ChurchModel()
    @State private var sent = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if model.state == .unavailable {
                Text("Church search is not available right now.")
                    .font(.system(size: 14 * textScale))
                    .foregroundStyle(theme.textSecondary)
            } else {
                TextField("Search by church name and city", text: $model.query)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 16 * textScale))
                    .autocorrectionDisabled()
                    .onChange(of: model.query) { _, _ in model.queryChanged() }

                if model.showsKeepTypingHint {
                    hint("Keep typing to search.")
                } else if model.showsNoResultsHint {
                    hint("No churches found. Try the city too.")
                } else if let error = model.searchError {
                    hint(error)
                }

                ForEach(model.results) { result in
                    Button {
                        Task {
                            await model.pick(result.placeId)
                            // A failed save leaves any earlier church in place;
                            // only the one just tapped is an answer.
                            if let church = model.church, church.placeId == result.placeId, !sent {
                                sent = true
                                onSaved(church.name)
                            }
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(result.name)
                                .font(.system(size: 16 * textScale, weight: .medium))
                                .foregroundStyle(theme.text)
                            Text(result.address)
                                .font(.system(size: 13 * textScale))
                                .foregroundStyle(theme.textMuted)
                        }
                        .frame(maxWidth: .infinity, minHeight: minTapHeight, alignment: .leading)
                        .padding(.horizontal, Spacing.md)
                        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                        .contentShape(.rect(cornerRadius: Radius.md))
                        .overlay(alignment: .trailing) {
                            if model.savingPlaceId == result.placeId {
                                ProgressView().controlSize(.small).padding(.trailing, Spacing.md)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isSaving)
                }
            }
        }
        .task {
            model.configure(app.api)
            await model.load()
        }
        .alert(item: $model.errorAlert) { alert in
            Alert(title: Text(alert.title), message: Text(alert.message))
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 13 * textScale))
            .foregroundStyle(theme.textMuted)
    }
}

/// A showInApp card: SureWord's caption and a "Show me" button that goes there
/// and lights it up.
struct GuideShowMeCard: View {
    @Environment(\.theme) private var theme
    @Environment(\.textScaleFactor) private var textScale
    let card: ShowInAppCard
    let onShow: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.md) {
            Text(card.caption)
                .font(.system(size: 15 * textScale))
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onShow) {
                Label(card.target == .tour ? "Show me around" : "Show me", systemImage: "sparkles")
                    .frame(minHeight: 32)
            }
            .buttonStyle(AccentButtonStyle())
        }
        .padding(Spacing.md)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.accentBorder, lineWidth: 1)
        }
    }
}

/// "Read it to me" at the top of the welcome conversation: off by default,
/// saved to the account (`voiceMode`), and while on, each new SureWord
/// message is read aloud (`OnboardingVoice`).
struct GuideVoiceToggle: View {
    @Environment(\.theme) private var theme
    @Environment(\.textScaleFactor) private var textScale
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var settings = app.settings
        Toggle(isOn: $settings.voiceMode) {
            HStack(spacing: Spacing.sm) {
                Image(systemName: app.onboarding.voice.isSpeaking ? "speaker.wave.2.fill" : "speaker.wave.2")
                    .foregroundStyle(theme.accent)
                Text("Read it to me")
                    .font(.system(size: 15 * textScale, weight: .medium))
                    .foregroundStyle(theme.text)
            }
        }
        .toggleStyle(.switch)
        .tint(theme.accent)
        .padding(.horizontal, Spacing.lg)
        .frame(minHeight: 48)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1)
        }
    }
}

extension View {
    /// Voice mode for a chat list: while the welcome conversation is open
    /// with Read it to me on, every newly settled SureWord message is queued.
    func guideVoice(chat: ChatViewModel, app: AppModel) -> some View {
        modifier(GuideVoiceDriver(chat: chat, app: app))
    }
}

private struct GuideVoiceDriver: ViewModifier {
    let chat: ChatViewModel
    let app: AppModel

    private var isOn: Bool { app.settings.voiceMode && app.onboarding.isWelcome(chat) }

    /// Changes whenever a message settles or arrives.
    private var settledKey: String {
        chat.messages.filter { !$0.isStreaming }.map(\.id).joined(separator: ",")
    }

    func body(content: Content) -> some View {
        content
            .onChange(of: isOn, initial: true) { _, on in
                if on { app.onboarding.voice.update(messages: chat.messages) } else { app.onboarding.voice.stop() }
            }
            .onChange(of: settledKey) { _, _ in
                guard isOn else { return }
                app.onboarding.voice.update(messages: chat.messages)
            }
            .onChange(of: chat.activeConversationID) { _, _ in
                if !isOn { app.onboarding.voice.stop() }
            }
            .onDisappear { app.onboarding.voice.stop() }
    }
}
