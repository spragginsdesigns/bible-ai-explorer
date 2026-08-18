import SwiftUI

/// "Pick Up Your Cross" (Luke 9:23) — the guided daily walk as a timeline:
/// today's verse, why it was chosen from the user's actual week, how it
/// applies, a short study path, one question to carry, and the hand-off to
/// chat.
///
/// iOS port of `macos/SureWord/DailyCross/DailyCrossView.swift` (itself a port
/// of `mobile/app/(app)/cross.tsx`). On Android this is a pushed route opened
/// from the Bible header card and the morning notification; here it is a sheet
/// over the tab shell, so it can be reached from anywhere without owning a tab.
///
/// Navigation hooks (owned by TabShell, documented for the other lanes):
/// - `onOpenReader` — called after a study-path step has been handed to the
///   reader via `AppModel.pendingVerseReference`; the shell dismisses the
///   sheet and selects the Bible tab, whose root observes the pending
///   reference and pushes Lane 2's reader.
/// - `onOpenChat` — called after today's verse has been attached to
///   `app.chat.attachment`; the shell dismisses and selects the Chat tab, and
///   Lane 3's input bar renders the attachment chip.
struct CrossView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app

    var onOpenReader: () -> Void
    var onOpenChat: () -> Void

    private var model: DailyCrossModel { app.dailyCross }

    /// Replacing today's word is a small, irreversible act, so the button opens
    /// a confirmation with room to say what the new day should centre on.
    @State private var confirmingReplace = false
    @State private var focus = ""
    /// Set while a replacement is in flight so its arrival — and only its —
    /// lands a success haptic.
    @State private var replaceRequested = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(model.todayLabel)
                    .font(.footnote)
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.xl)
        }
        .background { MeshBackground() }
        .navigationTitle("Pick Up Your Cross")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                }
                .accessibilityLabel("Close")
            }
        }
        .task { model.load() }
        .sensoryFeedback(.success, trigger: model.entry?.reference) { _, reference in
            replaceRequested && reference != nil
        }
        .onChange(of: model.entry?.reference) {
            if model.entry != nil { replaceRequested = false }
        }
    }

    // MARK: - Timeline

    @ViewBuilder
    private func timeline(_ entry: DailyCrossEntry) -> some View {
        TimelineStop(systemImage: "cross", label: "TODAY'S VERSE") {
            GlassCard {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text(entry.reference)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(theme.accent)
                    Text(entry.text)
                        .font(.custom(FontFamily.verse, size: 20, relativeTo: .title3))
                        .foregroundStyle(theme.text)
                        .lineSpacing(11)
                        .textSelection(.enabled)
                    Text(entry.reason)
                        .font(.footnote)
                        .italic()
                        .foregroundStyle(theme.textMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }

        if let whyToday = entry.whyToday {
            TimelineStop(systemImage: "sparkles", label: "WHY THIS VERSE TODAY") {
                paragraph(whyToday)
            }
        }

        if let application = entry.application {
            TimelineStop(systemImage: "diamond.fill", label: "FOR YOU") {
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
                    .font(.subheadline.weight(.medium))
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

        TimelineStop(systemImage: "arrow.right", isLast: true) {
            Button {
                goDeeper(entry)
            } label: {
                Label("Go deeper in chat", systemImage: "sparkles")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(theme.accent)
                    .frame(maxWidth: .infinity, minHeight: 48)
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
                    Label("A different word for today", systemImage: "arrow.clockwise")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(theme.textFaint)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .overlay {
                            RoundedRectangle(cornerRadius: Radius.lg)
                                .strokeBorder(theme.borderStrong, lineWidth: 1)
                        }
                        .contentShape(.rect(cornerRadius: Radius.lg))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Ask for a different word for today")
            }
        }
    }

    private func replacePanel(_ entry: DailyCrossEntry) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Replace today's word with a new one? \(entry.reference) won't come back.")
                .font(.footnote)
                .foregroundStyle(theme.textSecondary)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)

            TextField("Anything it should centre on? (optional)", text: $focus)
                .textFieldStyle(.plain)
                .font(.subheadline)
                .padding(Spacing.sm)
                .background(theme.surface, in: .rect(cornerRadius: Radius.sm))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.sm)
                        .strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                .submitLabel(.done)
                .onSubmit { replaceToday() }
                .accessibilityLabel("What today's new word should centre on")

            HStack(spacing: Spacing.sm) {
                Button("Replace") { replaceToday() }
                    .buttonStyle(AccentButtonStyle())
                Spacer()
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
            .font(.subheadline)
            .foregroundStyle(theme.textSecondary)
            .lineSpacing(6)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func studyRow(_ step: DailyCrossStudyStep) -> some View {
        Button {
            openStudyStep(step)
        } label: {
            HStack(spacing: Spacing.sm) {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text("\(step.book) \(step.chapter)")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(theme.accent)
                    Text(step.focus)
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .lineSpacing(4)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(theme.textFaint)
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
        .accessibilityLabel("Read \(step.book) \(step.chapter)")
        .disabled(Bible.resolveReference("\(step.book) \(step.chapter)") == nil)
    }

    // MARK: - States

    private func errorState(_ message: String) -> some View {
        GlassCard(padding: Spacing.xl) {
            VStack(spacing: Spacing.md) {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.center)
                Button("Try again") { model.load(force: true) }
                    .buttonStyle(AccentButtonStyle())
            }
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Actions

    /// Hand the steer, if any, to the same route the assistant's setDailyCross
    /// tool uses, and let the model swap the day underneath the timeline.
    private func replaceToday() {
        let steer = focus.trimmingCharacters(in: .whitespacesAndNewlines)
        confirmingReplace = false
        focus = ""
        replaceRequested = true
        model.replaceToday(focus: steer.isEmpty ? nil : steer)
    }

    /// The study path names books by canonical KJV name. The reader hook is
    /// `AppModel.pendingVerseReference`: the Bible tab root observes it,
    /// resolves it through `Bible.resolveReference`, and pushes the reader
    /// itself (Lane 2's `BibleTabView`) — so this validates resolvability,
    /// hands the reference over, and lets the shell switch tabs.
    private func openStudyStep(_ step: DailyCrossStudyStep) {
        let reference = "\(step.book) \(step.chapter)"
        guard Bible.resolveReference(reference) != nil else { return }
        app.pendingVerseReference = reference
        onOpenReader()
    }

    /// Attach the verse to the next question and hand back to the shell — the
    /// iOS form of Android pushing `/` with `attachRef` / `attachText`. The
    /// translation is KJV because the verse text came from the server's KJV
    /// corpus, not from whatever the reader is currently set to.
    private func goDeeper(_ entry: DailyCrossEntry) {
        app.chat.attachment = VerseAttachment(
            reference: entry.reference,
            text: entry.text,
            translation: .kjv
        )
        onOpenChat()
    }
}

// MARK: - Timeline stop

/// One stop on the guided timeline: an amber node on a vertical rail, with the
/// section content to its right. The rail is what turns a stack of sections
/// into one walk.
private struct TimelineStop<Content: View>: View {
    @Environment(\.theme) private var theme

    /// Text nodes (step numbers, "?") stay text; section nodes take an SF
    /// Symbol — the Android glyphs (✝ ✦ ◆ ➜) don't survive on iOS.
    var glyph: String = ""
    var systemImage: String?
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
                        .font(.caption2.weight(.bold))
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
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(theme.accent)
            } else {
                Text(glyph)
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(theme.accent)
            }
        }
        .frame(width: 28, height: 28)
        // Subtle glow, so the rail reads as lit rather than drawn.
        .shadow(color: theme.accent.opacity(0.45), radius: 6)
    }
}

// MARK: - Loading

/// Softly glowing placeholder bars while the day is being prepared. A cold
/// generation is a real model call, so this can be on screen for a few seconds
/// and needs to look intentional. Widths are definite points, not measured
/// fractions — a greedy pulsing shape inside a scroll view keeps re-proposing
/// its width (see the macOS `LoadingBars` note in `DailyCrossView`).
private struct LoadingBars: View {
    @Environment(\.theme) private var theme

    private static let widths: [CGFloat] = [300, 260, 282, 184]

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
                .font(.footnote)
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
