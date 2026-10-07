import SwiftUI

/// Learn a verse - port of `mobile/src/features/learn/LearnScreen.tsx`, pushed
/// on the Bible stack from the Bible home's "Learn a verse" card.
///
/// Everything stateful lives in the shared `LearnModel` (`app.learn`): the
/// offline session, the review outbox and its revision-checked sync, the
/// suggestions. This view renders it: the conflict / pending / offline /
/// error notices, today's card in whichever practice mode it opened in, the
/// two review buttons (and a left swipe for Continue, as on Android), and
/// "Suggested for you".
struct LearnView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase

    private var model: LearnModel { app.learn }

    var body: some View {
        Group {
            if model.account == nil {
                Text("Sign in to learn your verses.")
                    .foregroundStyle(theme.textMuted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                session
            }
        }
        .background { MeshBackground() }
        .navigationTitle("Learn a verse")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let today = model.today {
                ToolbarItem(placement: .topBarTrailing) {
                    Text("\(today.knownCount) verses you know")
                        .font(.system(size: 13))
                        .foregroundStyle(theme.textMuted)
                        .fixedSize()
                }
            }
        }
        .onAppear { model.appear() }
        .onDisappear { model.disappear() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.sceneBecameActive() }
        }
    }

    private var session: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                notices
                practice
                if model.today != nil {
                    LearnSuggestionsSection(model: model, translation: app.settings.translation.rawValue)
                }
            }
            .padding(Spacing.xl)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Notices

    @ViewBuilder
    private var notices: some View {
        let snapshot = model.snapshot
        if let conflict = model.conflict {
            notice(tone: .accent) {
                Text("Newer schedule found for \(conflict.reference)")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(theme.text)
                Text("\(conflict.operationCount) local review\(conflict.operationCount == 1 ? "" : "s") cannot be applied to that newer stage.")
                    .font(.system(size: 15))
                    .foregroundStyle(theme.textMuted)
                noticeButton("Use latest schedule") { Task { await model.useLatest() } }
                    .disabled(model.interactionBusy)
            }
        }
        if snapshot.pendingCount > 0 && model.conflict == nil {
            notice(tone: .plain) {
                Text(
                    snapshot.connection == .syncing
                        ? "Syncing \(model.pendingLabel)..."
                        : "\(model.pendingLabel) on this device. \(snapshot.connection == .idle ? "Ready to sync." : "Waiting to sync.")"
                )
                .font(.system(size: 15))
                .foregroundStyle(theme.textMuted)
                if snapshot.connection != .syncing {
                    noticeButton("Retry sync") { model.runSync(reset: true) }
                }
            }
        }
        if snapshot.pendingCount == 0 && snapshot.connection == .offline {
            notice(tone: .plain) {
                Text(snapshot.message ?? "")
                    .font(.system(size: 15))
                    .foregroundStyle(theme.textMuted)
                noticeButton("Reconnect") { model.runSync(reset: true) }
            }
        }
        if let error = model.localError ?? (snapshot.connection == .error ? snapshot.message : nil) {
            notice(tone: .danger) {
                Text(error)
                    .font(.system(size: 15))
                    .foregroundStyle(theme.danger)
                if snapshot.hydrated {
                    noticeButton("Try again") { model.runSync(reset: true) }
                }
            }
        }
    }

    private enum Tone { case plain, accent, danger }

    private func notice<Content: View>(tone: Tone, @ViewBuilder content: () -> Content) -> some View {
        let border = switch tone {
        case .plain: theme.borderStrong
        case .accent: theme.accentBorder
        case .danger: theme.dangerBorder
        }
        let fill: Color = switch tone {
        case .plain: .clear
        case .accent: theme.accentSoft
        case .danger: theme.dangerSoft
        }
        return VStack(alignment: .leading, spacing: Spacing.xs) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
            .background(fill, in: .rect(cornerRadius: Radius.lg))
            .overlay { RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(border, lineWidth: 1) }
    }

    private func noticeButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(theme.accent)
            .frame(minHeight: 44)
            .buttonStyle(.plain)
    }

    // MARK: - Practice

    @ViewBuilder
    private var practice: some View {
        if model.showInitialLoading {
            Text("Loading your verses...")
                .foregroundStyle(theme.textMuted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.xl)
        } else if model.today == nil {
            emptyState(
                title: "Connect to download your practice verses.",
                hint: "Once downloaded, this session works without a connection."
            )
        } else if let card = model.card {
            cardView(card)
        } else if model.suggestionsView.showEmptyText {
            emptyState(title: "No verses are due right now.", hint: model.emptyHint)
        }
    }

    private func emptyState(title: String, hint: String) -> some View {
        VStack(spacing: Spacing.xl) {
            Text(title)
                .font(.custom(FontFamily.verse, size: 28, relativeTo: .title))
                .foregroundStyle(theme.text)
            Text(hint)
                .font(.system(size: 14))
                .foregroundStyle(theme.textMuted)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.xl)
    }

    private func cardView(_ card: LearnCard) -> some View {
        let text = model.verseText(card)
        let disabled = model.disabled
        let round = model.practiceRound
        return VStack(spacing: Spacing.xl) {
            Text("\(card.reference) · \(card.translation)")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(theme.accent)
                .frame(maxWidth: .infinity)

            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                notice(tone: .plain) {
                    Text("\(card.translation) text is temporarily unavailable.")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.text)
                    Text("Reconnect and reload before practicing this verse. SureWord will keep the requested translation.")
                        .font(.system(size: 15))
                        .foregroundStyle(theme.textMuted)
                    noticeButton("Reload verse") { model.runSync(reset: true) }
                }
            } else {
                VersePracticeView(
                    mode: model.mode,
                    text: text,
                    stage: card.stage,
                    seed: card.revision,
                    disabled: disabled,
                    onModeChange: { model.chooseMode($0) },
                    onTypedScore: { perfect in model.setTypedScore(perfect: perfect, round: round) }
                )
                .id(round)

                HStack(spacing: Spacing.md) {
                    Button {
                        Task { await model.review(.again) }
                    } label: {
                        Text("Practice again")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(theme.text)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .overlay {
                                RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.borderStrong, lineWidth: 1)
                            }
                            .contentShape(.rect(cornerRadius: Radius.lg))
                    }
                    .buttonStyle(.plain)
                    .disabled(disabled)
                    .opacity(disabled ? 0.5 : 1)

                    let continueDisabled = disabled || !model.typedReady
                    Button {
                        Task { await model.review(.good) }
                    } label: {
                        Text(model.interactionBusy ? "Saving..." : card.stage == 3 ? "I remembered" : "Continue")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Color(red: 0.07, green: 0.07, blue: 0.07))
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(theme.accent, in: .rect(cornerRadius: Radius.lg))
                            .contentShape(.rect(cornerRadius: Radius.lg))
                    }
                    .buttonStyle(.plain)
                    .disabled(continueDisabled)
                    .opacity(continueDisabled ? 0.5 : 1)
                    .sensoryFeedback(.success, trigger: model.round)
                }
            }
        }
        .padding(.vertical, Spacing.xl)
        // Android's swipe: a left swipe of 70pt with little vertical travel
        // passes the card, gated exactly like the Continue button.
        .gesture(
            DragGesture(minimumDistance: 30)
                .onEnded { value in
                    if value.translation.width < -70, abs(value.translation.height) < 45 {
                        Task { await model.review(.good) }
                    }
                }
        )
    }
}

/// "Suggested for you" - port of `SuggestedVerses.tsx`.
private struct LearnSuggestionsSection: View {
    @Environment(\.theme) private var theme
    let model: LearnModel
    let translation: String

    var body: some View {
        let view = model.suggestionsView
        if !view.rows.isEmpty || model.confirmation != nil {
            VStack(alignment: view.lead ? .center : .leading, spacing: Spacing.sm) {
                if !view.lead { Divider().overlay(theme.border).padding(.bottom, Spacing.sm) }
                Text(view.heading)
                    .font(view.lead ? .custom(FontFamily.verse, size: 24, relativeTo: .title2) : .system(size: 14, weight: .bold))
                    .foregroundStyle(view.lead ? theme.text : theme.textMuted)
                    .multilineTextAlignment(view.lead ? .center : .leading)
                if let confirmation = model.confirmation {
                    Text(confirmation)
                        .font(.system(size: 14))
                        .foregroundStyle(theme.textMuted)
                }
                ForEach(view.rows) { suggestion in
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(suggestion.reference)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(theme.accent)
                        Text(suggestion.text)
                            .font(.custom(FontFamily.verse, size: 20, relativeTo: .body))
                            .foregroundStyle(theme.text)
                        Text(suggestion.reason)
                            .font(.system(size: 14))
                            .foregroundStyle(theme.textMuted)
                        LearnThisVerseButton(
                            book: suggestion.book,
                            chapter: suggestion.chapter,
                            verse: suggestion.verse,
                            translation: translation,
                            source: .suggestion,
                            accessibilityName: "Learn \(suggestion.reference)",
                            onAdded: { model.suggestionAdded(suggestion) }
                        )
                        Button("Not now") { model.dismissSuggestion(suggestion) }
                            .font(.system(size: 14))
                            .foregroundStyle(theme.textMuted)
                            .frame(minHeight: 44)
                            .buttonStyle(.plain)
                            .accessibilityLabel("Dismiss \(suggestion.reference)")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, Spacing.md)
                }
            }
            .frame(maxWidth: .infinity, alignment: view.lead ? .center : .leading)
            .padding(.vertical, view.lead ? Spacing.xl : 0)
        }
    }
}
