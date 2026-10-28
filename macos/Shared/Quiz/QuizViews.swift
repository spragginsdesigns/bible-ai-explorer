import SwiftUI

/// "Quiz me" views shared by the Mac and iPhone/iPad apps (docs/quiz/PLAN.md,
/// mockups in docs/quiz/mockups). Each platform only decides where the screen
/// is shown and what the actions do; the screen itself is one view, which
/// grows a chapter column beside the quiz when the window is wide, like the
/// web page.

/// What the quiz asks its host to do. Every hop out of the quiz goes through
/// here so the Mac pane and the iOS push wire them to their own navigation.
struct QuizActions {
    /// Back to the reader.
    var close: () -> Void
    /// Open the quiz's chapter at this verse, flashed like a deep link.
    var readInContext: (_ verse: Int) -> Void
    /// Chat, with the composer filled and the verse attached.
    var ask: (_ prompt: String, _ reference: String, _ verseText: String) -> Void
    var openNote: (_ noteID: String) -> Void
    var continueTo: (_ location: Bible.Location) -> Void
    /// Learn a verse, from a Missed card's "Open Learn" once the verse is
    /// added (Android pushes `/today/learn`).
    var openLearn: () -> Void
}

// MARK: - Styles

private extension SureWordColors {
    /// Text on a filled gold button: near-black on the dark theme's bright
    /// gold, white on the light theme's deeper amber.
    var onAccent: Color { isDark ? Color(hex: 0x0A0A0A) : .white }
    /// The muted warm red of a wrong answer, softer than an error.
    var quizWrong: Color { danger.opacity(isDark ? 0.75 : 0.85) }
}

/// The gold filled button of the mockups ("Start quiz", "Check answer").
struct QuizPrimaryButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .appFont(.system(size: 16, weight: .semibold))
            .foregroundStyle(isEnabled ? theme.onAccent : theme.textGhost)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(
                isEnabled ? theme.accent.opacity(configuration.isPressed ? 0.8 : 1) : theme.surfaceStrong,
                in: .rect(cornerRadius: Radius.md)
            )
            .contentShape(.rect(cornerRadius: Radius.md))
    }
}

/// The outlined secondary button ("Read in context", "Ask about this").
struct QuizOutlineButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    var accent = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .appFont(.system(size: 14, weight: .semibold))
            .foregroundStyle(isEnabled ? (accent ? theme.accent : theme.textSecondary) : theme.textGhost)
            .padding(.horizontal, Spacing.md)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(configuration.isPressed ? theme.surfacePressed : .clear, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(accent ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.lg))
    }
}

/// The quiet text button ("Not now", "Done", "Show me the verse first").
struct QuizQuietButtonStyle: ButtonStyle {
    @Environment(\.theme) private var theme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .appFont(.system(size: 15))
            .foregroundStyle(configuration.isPressed ? theme.textSecondary : theme.textMuted)
            .frame(minHeight: 40)
            .padding(.horizontal, Spacing.md)
            .contentShape(.rect)
    }
}

private enum QuizFont {
    /// The question: large and clear. Dynamic Type on iPhone; the Mac has no
    /// text-size setting, so a fixed size reads the same as the web page.
    static var prompt: AppFont {
        #if os(macOS)
        return .system(size: 22, weight: .semibold)
        #else
        return .title2.weight(.semibold)
        #endif
    }

    static var option: AppFont {
        #if os(macOS)
        return .system(size: 15)
        #else
        return .body
        #endif
    }

    static func scripture(_ size: CGFloat) -> AppFont { .custom(FontFamily.verse, size: size) }
}

// MARK: - Entry card

/// "Quiz me on John 3", at the end of a chapter in either reader. Shows only
/// when someone is signed in, the setting is on and this chapter was not put
/// aside with "Not now" on this device. Hosts give it `.id` per chapter, so a
/// chapter change in place resets it.
struct QuizEntryCard: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    let book: Int
    let chapter: Int
    let title: String
    /// The page shows a translation other than the KJV the quiz uses.
    let showsKJVNote: Bool
    let onStart: () -> Void

    @State private var dismissed = false

    private var visible: Bool {
        app.learn.account != nil
            && app.settings.offerQuiz
            && !dismissed
            && !QuizDismissals.contains(book: book, chapter: chapter)
    }

    var body: some View {
        if visible {
            VStack(spacing: Spacing.md) {
                Text("Quiz me on \(title)")
                    .appFont(.system(size: 20, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                Text("\(QuizContract.length) questions from what you just read. Every answer comes with its verse.")
                    .appFont(.system(size: 15))
                    .foregroundStyle(theme.textMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if showsKJVNote {
                    Text("Questions come from the King James text.")
                        .appFont(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                        .multilineTextAlignment(.center)
                }
                Button("Start quiz", action: onStart)
                    .buttonStyle(QuizPrimaryButtonStyle())
                    .padding(.top, Spacing.xs)
                Button("Not now") {
                    QuizDismissals.dismiss(book: book, chapter: chapter)
                    dismissed = true
                }
                .buttonStyle(QuizQuietButtonStyle())
            }
            .padding(Spacing.xl)
            .frame(maxWidth: .infinity)
            .background(theme.bgElevated, in: .rect(cornerRadius: Radius.xl))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.xl)
                    .strokeBorder(theme.accent.opacity(theme.isDark ? 0.55 : 0.45), lineWidth: 1.5)
            }
            .shadow(color: theme.accent.opacity(theme.isDark ? 0.18 : 0.08), radius: 14)
            .accessibilityElement(children: .contain)
        }
    }
}

// MARK: - Screen

/// The whole quiz: header, progress, then loading, a question, the results or
/// an error. Wide enough (a Mac window, an iPad in landscape) it sets the
/// chapter beside the quiz with the current question's verses lit, as the web
/// page does.
struct QuizScreen: View {
    @Environment(\.theme) private var theme
    @Bindable var model: QuizModel
    let actions: QuizActions

    /// The width at which the chapter column joins the quiz.
    static let columnBreakpoint: CGFloat = 880

    var body: some View {
        GeometryReader { geometry in
            if geometry.size.width >= Self.columnBreakpoint {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    QuizChapterColumn(model: model)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    quizColumn
                        .frame(width: min(600, geometry.size.width * 0.5))
                        .frame(maxHeight: .infinity)
                        .background(theme.glassLight, in: .rect(cornerRadius: Radius.xl))
                        .overlay {
                            RoundedRectangle(cornerRadius: Radius.xl).strokeBorder(theme.border, lineWidth: 1)
                        }
                }
                .padding(Spacing.lg)
            } else {
                quizColumn
                    .frame(maxWidth: 680)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background { MeshBackground().ignoresSafeArea() }
    }

    private var quizColumn: some View {
        VStack(spacing: 0) {
            QuizHeader(model: model, onClose: actions.close)
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            QuizLoadingView(model: model)
        case .failed(let message):
            QuizErrorView(message: message, onRetry: { model.retry() }, onClose: actions.close)
        case .question:
            QuizQuestionView(model: model, actions: actions)
        case .results:
            QuizResultsView(model: model, actions: actions)
        }
    }
}

private struct QuizHeader: View {
    @Environment(\.theme) private var theme
    let model: QuizModel
    let onClose: () -> Void

    private var showsProgress: Bool { model.phase == .question && model.count > 0 }

    var body: some View {
        VStack(spacing: Spacing.md) {
            ZStack {
                Text(model.phase == .results ? model.title : "\(model.title) quiz")
                    .appFont(.system(size: 18, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .lineLimit(1)
                    .padding(.horizontal, 64)
                    .accessibilityAddTraits(.isHeader)
                HStack {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .appFont(.system(size: 17, weight: .medium))
                            .foregroundStyle(theme.textSecondary)
                            .frame(width: 44, height: 44)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close quiz")
                    Spacer()
                    if showsProgress {
                        Text("\(model.index + 1) of \(model.count)")
                            .appFont(.system(size: 15))
                            .foregroundStyle(theme.textMuted)
                            .monospacedDigit()
                            .accessibilityLabel("Question \(model.index + 1) of \(model.count)")
                    }
                }
            }
            if showsProgress {
                QuizProgressBar(count: model.count, filled: model.index + 1)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.top, Spacing.sm)
        .padding(.bottom, Spacing.md)
    }
}

/// One segment per question; completed and current segments are gold.
struct QuizProgressBar: View {
    @Environment(\.theme) private var theme
    let count: Int
    let filled: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<max(count, 0), id: \.self) { index in
                Capsule()
                    .fill(index < filled ? theme.accent : theme.surfaceStrong)
                    .frame(height: 6)
            }
        }
        .animation(.easeOut(duration: 0.25), value: filled)
        .accessibilityElement()
        .accessibilityLabel("Question \(filled) of \(count)")
    }
}

private struct QuizLoadingView: View {
    @Environment(\.theme) private var theme
    let model: QuizModel

    var body: some View {
        VStack(spacing: Spacing.md) {
            ProgressView().controlSize(.regular)
            Text(QuizRules.loadingLine(title: model.title))
                .appFont(.system(size: 15))
                .foregroundStyle(theme.textSecondary)
                .multilineTextAlignment(.center)
            if model.slow {
                Text(QuizRules.slowLoadingLine)
                    .appFont(.system(size: 13))
                    .foregroundStyle(theme.textFaint)
                    .multilineTextAlignment(.center)
                    .transition(.opacity)
            }
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeIn(duration: 0.4), value: model.slow)
        .accessibilityElement(children: .combine)
    }
}

private struct QuizErrorView: View {
    @Environment(\.theme) private var theme
    let message: String
    let onRetry: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: Spacing.md) {
            Text(message)
                .appFont(.system(size: 15))
                .foregroundStyle(theme.textSecondary)
                .multilineTextAlignment(.center)
            Button("Retry", action: onRetry)
                .buttonStyle(QuizPrimaryButtonStyle())
                .frame(maxWidth: 280)
            Button("Back to the chapter", action: onClose)
                .buttonStyle(QuizQuietButtonStyle())
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Question

private struct QuizQuestionView: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable var model: QuizModel
    let actions: QuizActions

    var body: some View {
        if let question = model.current {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: Spacing.lg) {
                            if model.canSwitchDepth { depthSwitch }
                            Text(QuizRules.verseLabel(reference: question.reference, verses: question.verses))
                                .appFont(.system(size: 13, weight: .semibold))
                                .tracking(1.6)
                                .foregroundStyle(theme.accent)
                                .padding(.top, Spacing.sm)
                            Text(question.prompt)
                                .appFont(QuizFont.prompt)
                                .foregroundStyle(theme.text)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityAddTraits(.isHeader)
                            VStack(spacing: Spacing.md) {
                                ForEach(question.options.indices, id: \.self) { index in
                                    QuizOptionRow(
                                        letter: QuizRules.letter(index),
                                        text: question.options[index],
                                        state: state(of: index, in: question),
                                        action: { model.select(index) }
                                    )
                                    .disabled(model.checked)
                                }
                            }
                            if model.showsVerse {
                                QuizVerseCard(question: question, actions: actions)
                                    .id("verse")
                                    .transition(.opacity)
                            }
                        }
                        .padding(.horizontal, Spacing.lg)
                        .padding(.bottom, Spacing.xl)
                    }
                    .id(question.id)
                    .onChange(of: model.showsVerse) { _, shown in
                        guard shown else { return }
                        // Bottom anchor reveals the card with the least movement, so the
                        // question stays in view instead of scrolling off the top.
                        if reduceMotion { proxy.scrollTo("verse", anchor: .bottom) } else {
                            withAnimation(.easeOut(duration: 0.3)) { proxy.scrollTo("verse", anchor: .bottom) }
                        }
                    }
                }
                bottomBar
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: model.checked)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: model.revealedVerse)
            .modifier(QuizKeyboard(model: model))
        }
    }

    private var depthSwitch: some View {
        Picker("Depth", selection: Binding(get: { model.depth }, set: { model.switchDepth($0) })) {
            ForEach(QuizDepth.allCases) { depth in
                Text(depth.label).tag(depth)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .accessibilityLabel("Question style")
    }

    private func state(of index: Int, in question: QuizQuestion) -> QuizOptionRow.OptionState {
        guard model.checked else { return model.selection == index ? .selected : .idle }
        let chosen = model.selection
        if index == chosen { return index == question.answerIndex ? .correct : .wrong }
        if index == question.answerIndex { return .answer }
        return .dimmed
    }

    private var bottomBar: some View {
        VStack(spacing: Spacing.xs) {
            if model.checked {
                Button(model.isLast ? "See how you did" : "Next question") { model.advance() }
                    .buttonStyle(QuizPrimaryButtonStyle())
            } else {
                Button("Check answer") { model.check() }
                    .buttonStyle(QuizPrimaryButtonStyle())
                    .disabled(model.selection == nil)
                if !model.revealedVerse {
                    Button("Show me the verse first") { model.revealedVerse = true }
                        .buttonStyle(QuizQuietButtonStyle())
                }
            }
            #if os(macOS)
            Text(model.checked ? "Press Return" : "Choose with A to D, then press Return")
                .appFont(.system(size: 11))
                .foregroundStyle(theme.textFaint)
            #endif
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.top, Spacing.sm)
        .padding(.bottom, Spacing.md)
    }
}

/// A-D or 1-4 picks an option and Return checks it, then moves on, on the Mac.
/// Key presses, not menu-style shortcuts: a shortcut with no modifier would
/// take the letter from the sidebar's search field, while a key press only
/// reaches the quiz when the quiz has focus.
private struct QuizKeyboard: ViewModifier {
    let model: QuizModel
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        #if os(macOS)
        content
            .focusable()
            .focusEffectDisabled()
            .focused($focused)
            .onAppear { focused = true }
            .onKeyPress(phases: .down) { press in handle(press) }
        #else
        content
        #endif
    }

    private func handle(_ press: KeyPress) -> KeyPress.Result {
        if press.key == .return {
            if model.checked {
                model.advance()
            } else if model.selection != nil {
                model.check()
            } else {
                return .ignored
            }
            return .handled
        }
        guard !model.checked, let question = model.current else { return .ignored }
        let key = press.characters.lowercased()
        guard let index = ["a", "b", "c", "d"].firstIndex(of: key) ?? ["1", "2", "3", "4"].firstIndex(of: key),
              question.options.indices.contains(index)
        else { return .ignored }
        model.select(index)
        return .handled
    }
}

/// One answer choice: a lettered circle and the text, full width.
struct QuizOptionRow: View {
    enum OptionState: Equatable {
        case idle, selected
        /// Chosen and right.
        case correct
        /// Chosen and wrong.
        case wrong
        /// The right answer the reader did not choose.
        case answer
        case dimmed
    }

    @Environment(\.theme) private var theme
    let letter: String
    let text: String
    let state: OptionState
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.md) {
                letterBadge
                Text(text)
                    .appFont(QuizFont.option)
                    .foregroundStyle(state == .dimmed ? theme.textFaint : theme.text)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                trailing
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.md)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .background(fill, in: .rect(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md).strokeBorder(stroke, lineWidth: emphasised ? 1.5 : 1)
            }
            .opacity(state == .dimmed ? 0.6 : 1)
            .contentShape(.rect(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Option \(letter): \(text)")
        .accessibilityValue(spokenState)
        .accessibilityAddTraits(state == .selected || state == .correct || state == .wrong ? .isSelected : [])
    }

    private var emphasised: Bool { state != .idle && state != .dimmed }

    private var fill: Color {
        switch state {
        case .selected, .correct: theme.accentSoft
        case .wrong: theme.danger.opacity(0.06)
        default: theme.surface
        }
    }

    private var stroke: Color {
        switch state {
        case .selected, .correct: theme.accent
        case .answer: theme.accentDim
        case .wrong: theme.quizWrong
        case .idle, .dimmed: theme.borderStrong
        }
    }

    private var letterBadge: some View {
        let filled = state == .selected || state == .correct
        return Text(letter)
            .appFont(.system(size: 15, weight: .semibold))
            .foregroundStyle(filled ? theme.onAccent : (state == .dimmed ? theme.textFaint : theme.textSecondary))
            .frame(width: 34, height: 34)
            .background(filled ? theme.accent : .clear, in: .circle)
            .overlay {
                if !filled { Circle().strokeBorder(theme.borderStrong, lineWidth: 1.5) }
            }
    }

    @ViewBuilder
    private var trailing: some View {
        switch state {
        case .correct:
            Label("Right", systemImage: "checkmark.circle.fill")
                .labelStyle(QuizTrailingLabelStyle())
                .foregroundStyle(theme.accent)
        case .wrong:
            Label("Not quite", systemImage: "xmark.circle")
                .labelStyle(QuizTrailingLabelStyle())
                .foregroundStyle(theme.quizWrong)
        case .answer:
            Image(systemName: "checkmark.circle.fill")
                .appFont(.system(size: 20))
                .foregroundStyle(theme.accent)
        default:
            EmptyView()
        }
    }

    private var spokenState: String {
        switch state {
        case .idle, .dimmed: ""
        case .selected: "Selected"
        case .correct: "Selected, correct"
        case .wrong: "Selected, incorrect"
        case .answer: "Correct answer"
        }
    }
}

private struct QuizTrailingLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.appFont(.system(size: 20))
            configuration.title.appFont(.system(size: 15, weight: .semibold))
        }
        .fixedSize()
    }
}

/// The verse an answer comes from: a gold rule, the reference in spaced
/// capitals, the KJV words in the Scripture face, and the one-line note.
struct QuizVerseCard: View {
    @Environment(\.theme) private var theme
    let question: QuizQuestion
    let actions: QuizActions

    var body: some View {
        HStack(spacing: 0) {
            Rectangle().fill(theme.accent).frame(width: 3)
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(question.reference.uppercased())
                    .appFont(.system(size: 13, weight: .semibold))
                    .tracking(2.4)
                    .foregroundStyle(theme.accent)
                Text(question.verseText)
                    .appFont(QuizFont.scripture(23))
                    .foregroundStyle(theme.text)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                if let note = question.note, !note.isEmpty {
                    Divider().overlay(theme.border)
                    Text(note)
                        .appFont(.system(size: 14))
                        .foregroundStyle(theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Spacing.md) { buttons }
                    VStack(spacing: Spacing.sm) { buttons }
                }
                .padding(.top, Spacing.xs)
            }
            .padding(Spacing.lg)
        }
        .background(theme.bgElevated, in: .rect(cornerRadius: Radius.lg))
        .clipShape(.rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var buttons: some View {
        Button {
            actions.readInContext(question.verses.first ?? 1)
        } label: {
            Label("Read in context", systemImage: "book").lineLimit(1).fixedSize()
        }
        .buttonStyle(QuizOutlineButtonStyle())
        Button {
            actions.ask(
                QuizRules.askPrompt(reference: question.reference, prompt: question.prompt),
                question.reference,
                question.verseText
            )
        } label: {
            Label("Ask about this", systemImage: "bubble.left").lineLimit(1).fixedSize()
        }
        .buttonStyle(QuizOutlineButtonStyle())
    }
}

// MARK: - Results

private struct QuizResultsView: View {
    @Environment(\.theme) private var theme
    @Bindable var model: QuizModel
    let actions: QuizActions

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: Spacing.lg) {
                    VStack(spacing: Spacing.sm) {
                        Image(systemName: "sparkle")
                            .appFont(.system(size: 34, weight: .light))
                            .foregroundStyle(theme.accent)
                            .accessibilityHidden(true)
                        Text(QuizRules.headline(correct: model.correctCount, total: model.count))
                            .appFont(QuizFont.scripture(36))
                            .foregroundStyle(theme.text)
                            .multilineTextAlignment(.center)
                            .accessibilityAddTraits(.isHeader)
                        Text(QuizRules.subline(missed: model.missed.count))
                            .appFont(.system(size: 16))
                            .foregroundStyle(theme.textMuted)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.vertical, Spacing.md)

                    ForEach(model.missed) { question in
                        QuizMissedCard(
                            question: question,
                            chosen: model.chosen(for: question),
                            book: model.book,
                            chapter: model.chapter,
                            actions: actions
                        )
                    }

                    if let reflection = model.quiz?.reflection {
                        QuizReflectionCard(model: model, reflection: reflection, onOpen: actions.openNote)
                    }
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.bottom, Spacing.xl)
            }
            VStack(spacing: Spacing.xs) {
                if let next = model.next {
                    Button("Continue to \(next.title)") { actions.continueTo(next.location) }
                        .buttonStyle(QuizPrimaryButtonStyle())
                }
                Button("Done", action: actions.close)
                    .buttonStyle(QuizQuietButtonStyle())
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.sm)
            .padding(.bottom, Spacing.md)
        }
    }
}

private struct QuizMissedCard: View {
    @Environment(\.theme) private var theme
    let question: QuizQuestion
    let chosen: Int?
    let book: Int
    let chapter: Int
    let actions: QuizActions

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Missed")
                .appFont(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.accent)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(theme.accentSoft, in: .rect(cornerRadius: Radius.sm))
            Text(question.prompt)
                .appFont(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.text)
                .fixedSize(horizontal: false, vertical: true)
            if let chosen, question.options.indices.contains(chosen) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your answer")
                        .appFont(.system(size: 13))
                        .foregroundStyle(theme.textMuted)
                    Text(question.options[chosen])
                        .appFont(QuizFont.scripture(19))
                        .strikethrough(true, color: theme.textFaint)
                        .foregroundStyle(theme.textFaint)
                }
                .accessibilityElement(children: .combine)
            }
            if question.options.indices.contains(question.answerIndex) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Correct answer")
                        .appFont(.system(size: 13))
                        .foregroundStyle(theme.accent)
                    Text(question.options[question.answerIndex])
                        .appFont(QuizFont.scripture(22))
                        .foregroundStyle(theme.accent)
                }
                .accessibilityElement(children: .combine)
            }
            Divider().overlay(theme.border)
            Text(question.verseText)
                .appFont(QuizFont.scripture(20))
                .foregroundStyle(theme.text)
                .fixedSize(horizontal: false, vertical: true)
            Text(question.reference.uppercased())
                .appFont(.system(size: 12, weight: .semibold))
                .tracking(2.4)
                .foregroundStyle(theme.textFaint)
            HStack(alignment: .top, spacing: Spacing.md) {
                if let verse = question.verses.first {
                    LearnThisVerseButton(
                        book: book,
                        chapter: chapter,
                        verse: verse,
                        translation: TranslationID.kjv.rawValue,
                        source: .quiz,
                        accessibilityName: "Learn \(question.reference)",
                        onOpenLearn: actions.openLearn
                    )
                }
                Button("Ask about it") {
                    actions.ask(
                        QuizRules.askPrompt(reference: question.reference, prompt: question.prompt),
                        question.reference,
                        question.verseText
                    )
                }
                .buttonStyle(QuizOutlineButtonStyle())
                .padding(.vertical, Spacing.xs)
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.bgElevated, in: .rect(cornerRadius: Radius.xl))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.xl).strokeBorder(theme.border, lineWidth: 1)
        }
    }
}

/// "Carry it with you": one verse and one question, answered in a note.
private struct QuizReflectionCard: View {
    @Environment(\.theme) private var theme
    @Bindable var model: QuizModel
    let reflection: QuizReflection
    let onOpen: (String) -> Void

    private var canSave: Bool {
        !model.reflectionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.savingReflection
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Carry it with you")
                .appFont(.system(size: 21, weight: .semibold))
                .foregroundStyle(theme.text)
                .accessibilityAddTraits(.isHeader)
            Text(reflection.prompt)
                .appFont(.system(size: 15))
                .foregroundStyle(theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(reflection.verseText)
                    .appFont(QuizFont.scripture(20))
                    .foregroundStyle(theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text(reflection.reference.uppercased())
                    .appFont(.system(size: 12, weight: .semibold))
                    .tracking(2.4)
                    .foregroundStyle(theme.accent)
            }
            if let noteID = model.savedNoteID {
                HStack {
                    Label("Saved to your notes", systemImage: "checkmark.circle.fill")
                        .appFont(.system(size: 14, weight: .medium))
                        .foregroundStyle(theme.accent)
                    Spacer()
                    Button("Open") { onOpen(noteID) }
                        .buttonStyle(QuizOutlineButtonStyle(accent: true))
                        .frame(width: 96)
                }
            } else {
                ZStack(alignment: .topLeading) {
                    if model.reflectionText.isEmpty {
                        Text("Write a few words...")
                            .appFont(.system(size: 15))
                            .foregroundStyle(theme.textFaint)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 8)
                            .allowsHitTesting(false)
                    }
                    TextEditor(text: $model.reflectionText)
                        .appFont(.system(size: 15))
                        .foregroundStyle(theme.text)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 96)
                        .accessibilityLabel("Your reflection")
                }
                .padding(Spacing.sm)
                .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                HStack {
                    if let error = model.reflectionError {
                        Text(error)
                            .appFont(.system(size: 13))
                            .foregroundStyle(theme.danger)
                    }
                    Spacer()
                    Button(model.savingReflection ? "Saving..." : "Save as a note") {
                        Task { await model.saveReflection() }
                    }
                    .buttonStyle(QuizOutlineButtonStyle(accent: canSave))
                    .frame(width: 150)
                    .disabled(!canSave)
                }
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.bgElevated, in: .rect(cornerRadius: Radius.xl))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.xl).strokeBorder(theme.border, lineWidth: 1)
        }
    }
}

// MARK: - Chapter column

/// The chapter beside the quiz on a wide window, in the KJV the quiz is
/// written from, with the current question's verses lit and scrolled to.
private struct QuizChapterColumn: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let model: QuizModel

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.sm) {
                    Text(model.title)
                        .appFont(QuizFont.scripture(32))
                        .foregroundStyle(theme.text)
                        .padding(.bottom, Spacing.sm)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(Array(model.chapterVerses.enumerated()), id: \.offset) { offset, text in
                        let number = offset + 1
                        let lit = model.highlightedVerses.contains(number)
                        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                            Text("\(number)")
                                .appFont(.system(size: 12))
                                .foregroundStyle(lit ? theme.accent : theme.textFaint)
                                .frame(minWidth: 20, alignment: .trailing)
                            Text(text)
                                .appFont(QuizFont.scripture(19))
                                .foregroundStyle(theme.text)
                                .lineSpacing(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(lit ? theme.accentSoft : .clear, in: .rect(cornerRadius: Radius.md))
                        .id(number)
                    }
                }
                .padding(Spacing.xl)
            }
            .onChange(of: model.current?.verses.first, initial: true) { _, verse in
                guard let verse else { return }
                if reduceMotion { proxy.scrollTo(verse, anchor: .center) } else {
                    withAnimation(.easeOut(duration: 0.35)) { proxy.scrollTo(verse, anchor: .center) }
                }
            }
        }
        .background(theme.glassLight, in: .rect(cornerRadius: Radius.xl))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.xl).strokeBorder(theme.border, lineWidth: 1)
        }
    }
}
