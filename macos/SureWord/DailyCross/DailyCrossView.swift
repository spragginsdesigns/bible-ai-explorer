import SwiftUI

/// "Pick Up Your Cross" (Luke 9:23) — the guided daily walk, rendered as a
/// timeline: today's verse, why it was chosen from the user's actual week, how
/// it applies, a short study path, one question to carry, and the hand-off to
/// chat.
///
/// Port of `mobile/app/(app)/cross.tsx` and `src/app/cross/page.tsx`. Those are
/// pushed screens with a back button; on a Mac this is a sidebar section, so
/// the title moves to the window chrome and the rest is the same walk.
struct DailyCrossView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    private var model: DailyCrossModel { app.dailyCross }

    /// Replacing today's word is a small, irreversible act, so the button opens
    /// a confirmation with room to say what the new day should centre on.
    @State private var confirmingReplace = false
    @State private var focus = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(model.todayLabel)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textFaint)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.bottom, Spacing.xl)

                if let entry = model.entry {
                    timeline(entry)
                } else if let error = model.error {
                    errorState(error)
                } else {
                    LoadingBars()
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Spacing.xxl)
            .padding(.vertical, Spacing.xl)
        }
        .background { MeshBackground() }
        .navigationTitle("Pick Up Your Cross")
        .task {
            model.load()
            // The "FROM YOUR PLAN" tag reads the shared plan model, which the
            // Bible section owns; this screen may well be the first thing
            // opened in a session, so it asks for the plan itself.
            app.bible.plan.loadIfNeeded()
        }
    }

    // MARK: - Timeline

    @ViewBuilder
    private func timeline(_ entry: DailyCrossEntry) -> some View {
        TimelineStop(glyph: "✝", label: "TODAY'S VERSE") {
            GlassCard {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text(entry.reference)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text(entry.text)
                        .font(.custom(FontFamily.verse, size: 19))
                        .foregroundStyle(theme.text)
                        .lineSpacing(11)
                        .textSelection(.enabled)
                    Text(entry.reason)
                        .font(.system(size: 13))
                        .italic()
                        .foregroundStyle(theme.textMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }

        // An unconfigured server (no ELEVENLABS_API_KEY) offers nothing here -
        // not even the rail node - so the whole stop is conditional, not just
        // the card inside it.
        if model.listen.phase != .hidden {
            TimelineStop(glyph: "♪", label: "LISTEN") {
                ListenCard(model: model.listen, settings: app.settings)
            }
        }

        if let whyToday = entry.whyToday {
            TimelineStop(glyph: "✦", label: "WHY THIS VERSE TODAY") {
                paragraph(whyToday)
            }
        }

        if let application = entry.application {
            TimelineStop(glyph: "◆", label: "FOR YOU") {
                paragraph(application)
            }
        }

        ForEach(Array(entry.studyPath.enumerated()), id: \.offset) { index, step in
            TimelineStop(
                glyph: "\(index + 1)",
                label: index == 0 ? "TODAY'S STUDY" : nil
            ) {
                studyRow(step)
            }
        }

        if let question = entry.question {
            TimelineStop(glyph: "?", label: "CARRY THIS") {
                Text(question)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(theme.text)
                    .lineSpacing(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Spacing.lg)
                    .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.lg)
                            .strokeBorder(theme.accentBorder, lineWidth: 1)
                    }
            }
        }

        TimelineStop(glyph: "➜", isLast: true) {
            Button {
                goDeeper(entry)
            } label: {
                Text("✦ Go deeper in chat")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(theme.accent)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.lg)
                            .strokeBorder(theme.accentBorder, lineWidth: 1)
                    }
                    .contentShape(.rect(cornerRadius: Radius.lg))
            }
            .buttonStyle(.plain)

            if confirmingReplace {
                replacePanel(entry)
            } else {
                Button {
                    confirmingReplace = true
                } label: {
                    Text("↻ A different word for today")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.textFaint)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .overlay {
                            RoundedRectangle(cornerRadius: Radius.lg)
                                .strokeBorder(theme.borderStrong, lineWidth: 1)
                        }
                        .contentShape(.rect(cornerRadius: Radius.lg))
                }
                .buttonStyle(.plain)
                .help("Ask for a different word for today")
            }
        }
    }

    private func replacePanel(_ entry: DailyCrossEntry) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Replace today's word with a new one? \(entry.reference) won't come back.")
                .font(.system(size: 13))
                .foregroundStyle(theme.textSecondary)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)

            TextField("Anything it should centre on? (optional)", text: $focus)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .padding(Spacing.sm)
                .background(theme.surface, in: .rect(cornerRadius: Radius.sm))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.sm)
                        .strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                .onSubmit { replaceToday() }

            HStack(spacing: Spacing.sm) {
                Button("Replace") { replaceToday() }
                    .buttonStyle(AccentButtonStyle())
                Button("Cancel") {
                    confirmingReplace = false
                    focus = ""
                }
                .buttonStyle(SubtleButtonStyle())
            }
        }
        .padding(Spacing.md)
        .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.lg)
                .strokeBorder(theme.borderStrong, lineWidth: 1)
        }
    }

    private func paragraph(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundStyle(theme.textSecondary)
            .lineSpacing(6)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func studyRow(_ step: DailyCrossStudyStep) -> some View {
        Button {
            openStudyStep(step)
        } label: {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(spacing: Spacing.sm) {
                    Text("\(step.book) \(step.chapter) ›")
                        .font(.system(size: 13.5, weight: .bold))
                        .foregroundStyle(theme.accent)
                    // The daily cross is told to build its path out of the
                    // user's plan; this is how they see that it did.
                    if PlanView.isTodaysPlanReading(
                        app.bible.plan.plan,
                        book: step.book,
                        chapter: step.chapter
                    ) {
                        Text("FROM YOUR PLAN")
                            .font(.system(size: 9.5, weight: .bold))
                            .kerning(0.8)
                            .foregroundStyle(theme.textFaint)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .overlay {
                                Capsule().strokeBorder(theme.borderStrong, lineWidth: 1)
                            }
                    }
                }
                Text(step.focus)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textSecondary)
                    .lineSpacing(4)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(theme.borderStrong, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
        .help("Read \(step.book) \(step.chapter)")
        .disabled(reference(for: step) == nil)
    }

    // MARK: - States

    private func errorState(_ message: String) -> some View {
        GlassCard(padding: Spacing.xl) {
            VStack(spacing: Spacing.md) {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.center)
                Button("Try again") { model.load(force: true) }
                    .buttonStyle(AccentButtonStyle())
            }
            .frame(maxWidth: 360)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Actions

    /// The study path names books by canonical KJV name; the reader navigates
    /// by order, so it goes through the same resolver a typed reference does.
    private func reference(for step: DailyCrossStudyStep) -> Reference? {
        Bible.resolveReference("\(step.book) \(step.chapter)")
    }

    /// Hand the steer, if any, to the same route the assistant's setDailyCross
    /// tool uses, and let the model swap the day underneath the timeline.
    private func replaceToday() {
        let steer = focus.trimmingCharacters(in: .whitespacesAndNewlines)
        confirmingReplace = false
        focus = ""
        model.replaceToday(focus: steer.isEmpty ? nil : steer)
    }

    private func openStudyStep(_ step: DailyCrossStudyStep) {
        guard let reference = reference(for: step) else { return }
        app.bible.open(order: reference.order, chapter: reference.chapter)
        app.section = .bible
    }

    /// Attach the verse to the next question and switch to chat — the Mac form
    /// of the other clients pushing `/` with `attachRef` / `attachText`. The
    /// translation is KJV because the verse text came from the bundled KJV
    /// corpus, not from whatever the reader is currently set to.
    private func goDeeper(_ entry: DailyCrossEntry) {
        app.chat.attachment = VerseAttachment(
            reference: entry.reference,
            text: entry.text,
            translation: .kjv,
            origin: entry.id.map {
                VerseAttachmentOrigin(
                    surface: "daily-cross",
                    verseOfDayId: $0,
                    reference: entry.reference,
                    action: "go-deeper"
                )
            }
        )
        app.section = .chat
    }
}

// MARK: - Timeline stop

/// One stop on the guided timeline: an amber node on a vertical rail, with the
/// section content to its right. The rail is what turns a stack of sections
/// into one walk.
private struct TimelineStop<Content: View>: View {
    @Environment(\.theme) private var theme

    let glyph: String
    var label: String?
    var isLast = false
    @ViewBuilder var content: Content

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(spacing: 0) {
                node
                if !isLast {
                    // Flexible, so the rail stretches to whatever height the
                    // content column ends up with.
                    Capsule()
                        .fill(theme.accentBorder)
                        .frame(width: 2)
                        .frame(maxHeight: .infinity)
                        .padding(.vertical, 4)
                }
            }
            .frame(width: 28)

            VStack(alignment: .leading, spacing: Spacing.sm) {
                if let label {
                    Text(label)
                        .font(.system(size: 11, weight: .bold))
                        .kerning(1.2)
                        .foregroundStyle(theme.accentDim)
                        .padding(.top, 6)
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, isLast ? 0 : Spacing.xl)
        }
    }

    private var node: some View {
        ZStack {
            Circle().fill(theme.accentSoft)
            Circle().strokeBorder(theme.accentBorder, lineWidth: 1)
            Text(glyph)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(theme.accent)
        }
        .frame(width: 28, height: 28)
        // Subtle glow, so the rail reads as lit rather than drawn.
        .shadow(color: theme.accent.opacity(0.45), radius: 6)
    }
}

// MARK: - Loading

/// Softly glowing placeholder bars while the day is being prepared. A cold
/// generation is a real model call, so this can be on screen for a few seconds
/// and needs to look intentional.
private struct LoadingBars: View {
    @Environment(\.theme) private var theme

    /// Definite widths, not measured fractions. A shape has no intrinsic size,
    /// so a greedy one pulsing forever inside a scroll view keeps re-proposing
    /// its width and re-measuring the content around it — the failure that made
    /// the reader's own skeleton unusable (see `VerseInsightView`).
    private static let widths: [CGFloat] = [616, 542, 580, 380]

    @State private var lit = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            ForEach(Array(Self.widths.enumerated()), id: \.offset) { index, width in
                Capsule()
                    .fill(theme.accentSoft)
                    .overlay {
                        Capsule().strokeBorder(theme.accentBorder, lineWidth: 1)
                    }
                    .frame(width: width, height: 14)
                    .opacity(lit ? 0.9 : 0.35)
                    .animation(
                        .easeInOut(duration: 1.1)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.15),
                        value: lit
                    )
            }

            Text("Preparing your day in the Word…")
                .font(.system(size: 13))
                .foregroundStyle(theme.textFaint)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, Spacing.sm)
        }
        .padding(.vertical, Spacing.xl)
        .onAppear { lit = true }
        .accessibilityElement()
        .accessibilityLabel("Preparing your day")
    }
}
