import SwiftUI

/// Reading plans on iPhone and iPad: one plan at a time, with progress that
/// fills itself in from the chapters read in the reader.
///
/// Port of Android's `mobile/app/(app)/bible/plan.tsx`, pushed on the Bible
/// stack from the Bible home's plan card exactly as Android pushes
/// `/bible/plan`. All state and every call live in the shared
/// `ReadingPlanModel` (`app.bible.plan`), which the Mac's `ReadingPlanPane`
/// also drives, so the card, this screen and the Daily Cross "FROM YOUR PLAN"
/// tag read one plan. A day's chapter chips push the reader.
struct ReadingPlanView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    @State private var goal = ""
    @State private var goalDays = ReadingPlanModel.defaultGoalDays
    @State private var isConfirmingArchive = false
    @State private var readerRequest: BibleReaderRequest?

    private var model: ReadingPlanModel { app.bible.plan }

    var body: some View {
        content
            .background { MeshBackground() }
            .navigationTitle("Reading plan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if model.loading || model.isBusy {
                        ProgressView()
                            .accessibilityLabel(model.isWriting ? "Writing your plan" : "Working")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if model.plan != nil {
                        Menu {
                            Button("Refresh", systemImage: "arrow.clockwise") { model.reload() }
                                .disabled(model.isBusy)
                            Button("Archive plan…", systemImage: "archivebox", role: .destructive) {
                                isConfirmingArchive = true
                            }
                            .disabled(model.isBusy)
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                        .accessibilityLabel("Plan options")
                    }
                }
            }
            // Reload rather than load-once: days tick themselves off as the
            // user reads, so a plan opened again after reading must not still
            // say "Upcoming". What is on screen stays while this runs.
            .task { model.reload() }
            .refreshable { model.reload() }
            .confirmationDialog(
                "Put this plan away?",
                isPresented: $isConfirmingArchive,
                titleVisibility: .visible
            ) {
                Button("Archive plan", role: .destructive) { model.archive() }
                Button("Keep it", role: .cancel) {}
            } message: {
                Text(archivePrompt)
            }
            .navigationDestination(item: $readerRequest) { request in
                ChapterReaderView(order: request.order, chapter: request.chapter)
            }
    }

    private var archivePrompt: String {
        guard let plan = model.plan else { return "" }
        return "“\(plan.title)” stops showing on the Bible screen. Your progress is kept, and you can start another plan."
    }

    @ViewBuilder
    private var content: some View {
        if let plan = model.plan {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.md) {
                    errorBanner
                    summaryCard(plan)
                    todayCard(plan)
                    sectionLabel("THE WHOLE PLAN")
                    ForEach(plan.days) { day in
                        dayRow(day)
                    }
                }
                .padding(Spacing.lg)
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        } else if model.isWriting {
            writingState
        } else if model.loading && !model.hasLoaded {
            VStack(spacing: Spacing.sm) {
                ProgressView()
                Text("Loading your plan…")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.textFaint)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            chooser
        }
    }

    /// A written plan is a model call that takes up to two minutes, so this
    /// says so rather than showing a bare spinner the user reads as a hang.
    private var writingState: some View {
        VStack(spacing: Spacing.md) {
            ProgressView().controlSize(.large)
            Text("Writing your plan…")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(theme.text)
            Text("SureWord is laying out all \(goalDays) days from the Scriptures. This takes up to two minutes - you can leave this open.")
                .font(.system(size: 14))
                .foregroundStyle(theme.textMuted)
                .multilineTextAlignment(.center)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let error = model.error {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.textSecondary)
                Button("Try again") { model.reload() }
                    .buttonStyle(AccentButtonStyle())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
            .background(theme.dangerSoft, in: .rect(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.dangerBorder, lineWidth: 1)
            }
        }
    }

    // MARK: - The plan

    private func summaryCard(_ plan: ReadingPlan) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(plan.title)
                    .font(.custom(FontFamily.brand, size: 28, relativeTo: .title))
                    .foregroundStyle(theme.text)
                if !plan.description.isEmpty {
                    Text(plan.description)
                        .font(.system(size: 14))
                        .foregroundStyle(theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                PlanProgressBar(percent: plan.percent)
                    .padding(.top, Spacing.xs)
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text("\(plan.percent)%")
                        .font(.system(size: 24, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(theme.accent)
                    Text(PlanView.progressCaption(plan))
                        .font(.system(size: 13))
                        .foregroundStyle(theme.textFaint)
                }
                Label(PlanView.streakLabel(plan.streak), systemImage: "flame")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(plan.streak > 0 ? theme.accentDim : theme.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func todayCard(_ plan: ReadingPlan) -> some View {
        if plan.status == .completed {
            GlassCard {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("You finished it.")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text("Every day of \(plan.title) is read. Archive it from the ⋯ menu above to start another.")
                        .font(.system(size: 14))
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else if let today = PlanView.currentPlanDay(plan) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(PlanView.dayHeadline(plan).uppercased())
                    .font(.system(size: 12, weight: .bold))
                    .kerning(1.1)
                    .foregroundStyle(theme.accent)

                PlanChipFlow(spacing: Spacing.sm) {
                    ForEach(today.readings) { reading in
                        chapterChip(reading)
                    }
                }

                if !today.focus.isEmpty {
                    Text(today.focus)
                        .font(.system(size: 15))
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    model.setDayDone(today.day, done: !today.done)
                } label: {
                    Label(
                        today.done ? "Read" : "Mark this day read",
                        systemImage: today.done ? "checkmark.circle.fill" : "circle"
                    )
                    .font(.system(size: 15, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .foregroundStyle(today.done ? theme.accent : theme.textMuted)
                    .background(today.done ? theme.accentSoft : .clear, in: .rect(cornerRadius: Radius.md))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.md)
                            .strokeBorder(today.done ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
                    }
                    .contentShape(.rect(cornerRadius: Radius.md))
                }
                .buttonStyle(.plain)
                .disabled(model.isBusy)
                .sensoryFeedback(.success, trigger: today.done) { old, new in !old && new }
                .accessibilityLabel(today.done ? "Mark day \(today.day) unread" : "Mark day \(today.day) read")

                if !today.done {
                    Text("Reading these chapters in SureWord marks the day on its own.")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textGhost)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.accentBorder, lineWidth: 1)
            }
        }
    }

    private func chapterChip(_ reading: PlanReading) -> some View {
        Button {
            open(reading)
        } label: {
            HStack(spacing: 4) {
                Text("\(reading.book) \(reading.chapter)")
                    .font(.system(size: 14, weight: .bold))
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
            }
            .foregroundStyle(theme.accent)
            .padding(.horizontal, Spacing.md)
            .frame(minHeight: 36)
            .background(theme.bgElevated, in: .capsule)
            .overlay { Capsule().strokeBorder(theme.accentBorder, lineWidth: 1) }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Read \(reading.book) \(reading.chapter)")
    }

    /// The plan names books the way the KJV data does, so the shared resolver
    /// is all the translation needed - the Mac's plan pane does the same.
    private func open(_ reading: PlanReading) {
        guard let reference = Bible.resolveReference("\(reading.book) \(reading.chapter)") else { return }
        app.bible.open(reference)
        readerRequest = BibleReaderRequest(order: reference.order, chapter: reference.chapter, verse: nil)
    }

    private func dayRow(_ day: PlanDay) -> some View {
        let isToday = day.state == .today
        return HStack(spacing: Spacing.md) {
            Text("\(day.day)")
                .font(.system(size: 13, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(theme.textFaint)
                .frame(minWidth: 30, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(PlanView.describeReadings(day.readings))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(2)
                Text(stateCaption(day))
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textGhost)
            }
            Spacer(minLength: Spacing.sm)
            Button {
                model.setDayDone(day.day, done: !day.done)
            } label: {
                Image(systemName: day.done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(day.done ? theme.accent : theme.textGhost)
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(model.isBusy)
            .accessibilityLabel("Mark day \(day.day) \(day.done ? "unread" : "read")")
        }
        .padding(.leading, Spacing.lg)
        .padding(.trailing, Spacing.xs)
        .padding(.vertical, Spacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isToday ? theme.accentSoft : theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(isToday ? theme.accentBorder : theme.border, lineWidth: 1)
        }
        .opacity(day.done ? 0.72 : 1)
    }

    private func stateCaption(_ day: PlanDay) -> String {
        let label = PlanView.dayStateLabel(day.state)
        return day.doneSource == .read ? "\(label) · read in SureWord" : label
    }

    // MARK: - The chooser

    private var chooser: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                errorBanner
                Text("Pick a plan and read straight through. Chapters you read in SureWord tick themselves off - there is nothing to remember.")
                    .font(.system(size: 15))
                    .foregroundStyle(theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)

                ForEach(model.presets) { preset in
                    presetCard(preset)
                }

                if model.presets.isEmpty && model.hasLoaded && model.error == nil {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text("No plans came back from the server. Try again in a moment.")
                            .font(.system(size: 14))
                            .foregroundStyle(theme.textFaint)
                        Button("Try again") { model.reload() }
                            .buttonStyle(AccentButtonStyle())
                            .disabled(model.loading || model.isBusy)
                    }
                }

                sectionLabel("BUILD MY OWN")
                builder
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 640, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }

    private func presetCard(_ preset: ReadingPlanPreset) -> some View {
        Button {
            model.startPreset(preset.key)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(preset.title)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(theme.text)
                    Spacer(minLength: Spacing.sm)
                    if model.activity == .starting(preset.key) {
                        ProgressView()
                    }
                    Text("\(preset.dayCount) days")
                        .font(.system(size: 13))
                        .monospacedDigit()
                        .foregroundStyle(theme.accent)
                }
                Text(preset.description)
                    .font(.system(size: 14))
                    .foregroundStyle(theme.textMuted)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.lg)
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(theme.border, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .disabled(model.isBusy)
        .accessibilityLabel("Start \(preset.title), \(preset.dayCount) days")
    }

    private var builder: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.md) {
                TextField(
                    "What should it walk you through? e.g. everything Jesus said about prayer",
                    text: $goal,
                    axis: .vertical
                )
                .lineLimit(3...6)
                .font(.system(size: 15))
                .foregroundStyle(theme.text)
                .padding(Spacing.md)
                .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.md).strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                .onChange(of: goal) { _, value in
                    if value.count > ReadingPlanModel.maxGoalLength {
                        goal = String(value.prefix(ReadingPlanModel.maxGoalLength))
                    }
                }
                .accessibilityLabel("What the plan should walk you through")

                // `onIncrement`/`onDecrement` rather than `value:in:step:`, which
                // refuses a step that would leave the range instead of clamping,
                // so 365 was unreachable (`ReadingPlanModel.adjustedGoalDays`).
                Stepper {
                    Text("\(goalDays) days")
                        .font(.system(size: 15, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(theme.text)
                } onIncrement: {
                    goalDays = ReadingPlanModel.adjustedGoalDays(goalDays, by: ReadingPlanModel.goalDayStep)
                } onDecrement: {
                    goalDays = ReadingPlanModel.adjustedGoalDays(goalDays, by: -ReadingPlanModel.goalDayStep)
                }
                .accessibilityLabel("Plan length in days")

                HStack(spacing: Spacing.sm) {
                    ForEach(ReadingPlanModel.goalDayChoices, id: \.self) { choice in
                        Button {
                            goalDays = choice
                        } label: {
                            Text("\(choice)")
                                .font(.system(size: 14, weight: goalDays == choice ? .bold : .regular))
                                .monospacedDigit()
                                .foregroundStyle(goalDays == choice ? theme.accent : theme.textMuted)
                                .frame(maxWidth: .infinity, minHeight: 36)
                                .background(goalDays == choice ? theme.accentSoft : .clear, in: .capsule)
                                .overlay {
                                    Capsule().strokeBorder(
                                        goalDays == choice ? theme.accentBorder : theme.borderStrong,
                                        lineWidth: 1
                                    )
                                }
                                .contentShape(.capsule)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(choice) days")
                    }
                }

                Button {
                    let described = goal.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !described.isEmpty else { return }
                    // Consent first, so "Not now" keeps the typed goal.
                    AIConsentGate.require {
                        goal = ""
                        model.startGoal(described, days: goalDays)
                    }
                } label: {
                    Text(model.isWriting ? "Writing your plan…" : "✦ Build my plan")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(model.isBusy || goal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Text("A written plan takes up to two minutes - SureWord reads your study and lays out every day.")
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textGhost)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .bold))
            .kerning(1.2)
            .foregroundStyle(theme.textFaint)
            .padding(.top, Spacing.sm)
    }
}

/// Wrapping row of chips - the chips are all different widths, so a grid
/// would column-align them.
struct PlanChipFlow: Layout {
    var spacing: CGFloat = Spacing.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = rows(subviews: subviews, width: width)
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: min(width, rows.map(\.width).max() ?? 0), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(subviews: subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func rows(subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let advance = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            if !row.indices.isEmpty, advance > width {
                rows.append(row)
                row = Row(indices: [index], width: size.width, height: size.height)
            } else {
                row.indices.append(index)
                row.width = advance
                row.height = max(row.height, size.height)
            }
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}

/// The plan's progress as a filled track.
struct PlanProgressBar: View {
    @Environment(\.theme) private var theme
    let percent: Int

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(theme.surfaceStrong)
                Capsule()
                    .fill(theme.accent)
                    .frame(width: proxy.size.width * CGFloat(min(max(percent, 0), 100)) / 100)
            }
        }
        .frame(height: 8)
        .accessibilityLabel("\(percent) percent read")
    }
}
