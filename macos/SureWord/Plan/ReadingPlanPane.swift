import SwiftUI

/// Reading plans on the Mac: one plan at a time, with progress that fills
/// itself in from the chapters the user actually reads in the reader.
///
/// Android pushes a whole screen for this (`mobile/app/(app)/bible/plan.tsx`)
/// and web renders `/bible/plan`. Here it is a pane of the Bible section, so
/// the book list stays where it was - and a Mac window is wide enough to put
/// the plan itself beside the whole day list rather than above it. Under
/// `Layout.twoColumnWidth` it folds back into one column.
struct ReadingPlanPane: View {
    @Environment(\.theme) private var theme
    let model: ReadingPlanModel
    /// Open one of today's chapters in the reader.
    let onOpenReading: (PlanReading) -> Void
    /// Back to the books.
    let onDismiss: () -> Void

    private enum Layout {
        /// Below this the summary and the day list stack instead of splitting.
        static let twoColumnWidth: CGFloat = 860
        static let summaryColumnWidth: CGFloat = 380
        static let chooserWidth: CGFloat = 640
    }

    @State private var goal = ""
    @State private var goalDays = ReadingPlanModel.defaultGoalDays
    @State private var isConfirmingArchive = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(theme.border)
            content
        }
        // Reload rather than load-once: days tick themselves off as the user
        // reads in the reader, so a plan opened again after reading must not
        // still say "Upcoming". The plan already on screen stays put while this
        // runs - the loading state only shows before the first response lands.
        .task { model.reload() }
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
    }

    private var archivePrompt: String {
        guard let plan = model.plan else { return "" }
        return "“\(plan.title)” stops showing on the Bible screen. Your progress is kept, and you can start another plan."
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: Spacing.md) {
            Button(action: onDismiss) {
                Label("Bible", systemImage: "chevron.left")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .buttonStyle(SubtleButtonStyle())
            .help("Back to the books")

            VStack(alignment: .leading, spacing: 1) {
                Text("Reading plan")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.text)
                if let plan = model.plan {
                    Text(PlanView.planCardSubtitle(plan))
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: Spacing.md)

            if model.loading || model.isBusy {
                ProgressView()
                    .controlSize(.small)
                    .help(model.isWriting ? "Writing your plan…" : "Working…")
            }

            if model.plan != nil {
                Menu {
                    Button("Archive plan…", role: .destructive) { isConfirmingArchive = true }
                        .disabled(model.isBusy)
                    Divider()
                    Button("Refresh") { model.reload() }
                        .disabled(model.isBusy)
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.textMuted)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .frame(width: 28)
                .help("Plan options")
                .accessibilityLabel("Plan options")
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if let plan = model.plan {
            GeometryReader { proxy in
                if proxy.size.width >= Layout.twoColumnWidth {
                    HStack(alignment: .top, spacing: 0) {
                        ScrollView {
                            VStack(alignment: .leading, spacing: Spacing.md) {
                                errorBanner
                                summaryCard(plan)
                                todayCard(plan)
                            }
                            .padding(Spacing.lg)
                        }
                        .frame(width: Layout.summaryColumnWidth)

                        Divider().overlay(theme.border)

                        dayList(plan)
                            .frame(maxWidth: .infinity)
                    }
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: Spacing.md) {
                            errorBanner
                            summaryCard(plan)
                            todayCard(plan)
                            sectionLabel("THE WHOLE PLAN")
                            dayRows(plan)
                        }
                        .padding(Spacing.lg)
                        .frame(maxWidth: 720, alignment: .leading)
                        .frame(maxWidth: .infinity)
                    }
                }
            }
        } else if model.isWriting {
            writingState
        } else if model.loading && !model.hasLoaded {
            loadingState
        } else {
            chooser
        }
    }

    private var loadingState: some View {
        VStack(spacing: Spacing.sm) {
            ProgressView().controlSize(.small)
            Text("Loading your plan…")
                .font(.system(size: 12))
                .foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// The written plan is a model call over the whole study context and takes
    /// up to two minutes, so this says so rather than showing a bare spinner
    /// the user reads as a hang.
    private var writingState: some View {
        VStack(spacing: Spacing.md) {
            ProgressView()
                .controlSize(.large)
            Text("Writing your plan…")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.text)
            Text("SureWord is laying out all \(goalDays) days from the Scriptures. This takes up to two minutes - you can leave this open.")
                .font(.system(size: 12))
                .foregroundStyle(theme.textMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let error = model.error {
            HStack(alignment: .top, spacing: Spacing.md) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 13))
                    .foregroundStyle(theme.danger)
                Text(error)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: Spacing.sm)
                Button("Try again") { model.reload() }
                    .buttonStyle(AccentButtonStyle())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.md)
            .background(theme.dangerSoft, in: .rect(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(theme.dangerBorder, lineWidth: 1)
            }
        }
    }

    // MARK: - The plan

    private func summaryCard(_ plan: ReadingPlan) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(plan.title)
                    .font(.custom(FontFamily.brand, size: 26))
                    .foregroundStyle(theme.text)
                if !plan.description.isEmpty {
                    Text(plan.description)
                        .font(.system(size: 12.5))
                        .foregroundStyle(theme.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ProgressBar(percent: plan.percent)
                    .padding(.top, Spacing.xs)

                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text("\(plan.percent)%")
                        .font(.system(size: 22, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(theme.accent)
                    Text(PlanView.progressCaption(plan))
                        .font(.system(size: 11.5))
                        .foregroundStyle(theme.textFaint)
                }

                Label(PlanView.streakLabel(plan.streak), systemImage: "flame")
                    .font(.system(size: 12, weight: .semibold))
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
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Text("Every day of \(plan.title) is read. Archive it from the ⋯ menu above to start another.")
                        .font(.system(size: 12.5))
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else if let today = PlanView.currentPlanDay(plan) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(PlanView.dayHeadline(plan).uppercased())
                    .font(.system(size: 11, weight: .bold))
                    .kerning(1.1)
                    .foregroundStyle(theme.accent)

                FlowRow(spacing: Spacing.sm) {
                    ForEach(today.readings) { reading in
                        chapterChip(reading)
                    }
                }

                if !today.focus.isEmpty {
                    Text(today.focus)
                        .font(.system(size: 13))
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    model.setDayDone(today.day, done: !today.done)
                } label: {
                    HStack(spacing: Spacing.sm) {
                        Image(systemName: today.done ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 13))
                        Text(today.done ? "Read" : "Mark this day read")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.sm)
                    .foregroundStyle(today.done ? theme.accent : theme.textMuted)
                    .background(
                        today.done ? theme.accentSoft : .clear,
                        in: .rect(cornerRadius: Radius.md)
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.md)
                            .strokeBorder(today.done ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
                    }
                    .contentShape(.rect(cornerRadius: Radius.md))
                }
                .buttonStyle(.plain)
                .disabled(model.isBusy)
                .accessibilityLabel(today.done ? "Mark day \(today.day) unread" : "Mark day \(today.day) read")

                if !today.done {
                    Text("Reading these chapters in SureWord marks the day on its own.")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textGhost)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.accentSoft, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(theme.accentBorder, lineWidth: 1)
            }
        }
    }

    private func chapterChip(_ reading: PlanReading) -> some View {
        Button {
            onOpenReading(reading)
        } label: {
            HStack(spacing: 4) {
                Text("\(reading.book) \(reading.chapter)")
                    .font(.system(size: 12.5, weight: .bold))
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(theme.accent)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, 6)
            .background(theme.bgElevated, in: .capsule)
            .overlay { Capsule().strokeBorder(theme.accentBorder, lineWidth: 1) }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .help("Read \(reading.book) \(reading.chapter)")
        .accessibilityLabel("Read \(reading.book) \(reading.chapter)")
    }

    // MARK: - The whole plan

    private func dayList(_ plan: ReadingPlan) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.md) {
                sectionLabel("THE WHOLE PLAN")
                dayRows(plan)
            }
            .padding(Spacing.lg)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }

    private func dayRows(_ plan: ReadingPlan) -> some View {
        // A LazyVStack of static rows: no hover tracking anywhere in here, for
        // the reason the reader's own list carries (see macos/README.md).
        LazyVStack(alignment: .leading, spacing: Spacing.sm) {
            ForEach(plan.days) { day in
                dayRow(day)
            }
        }
    }

    private func dayRow(_ day: PlanDay) -> some View {
        let isToday = day.state == .today
        return HStack(alignment: .center, spacing: Spacing.md) {
            Text("\(day.day)")
                .font(.system(size: 12, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(theme.textFaint)
                .frame(width: 30, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                Text(PlanView.describeReadings(day.readings))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(stateCaption(day))
                    .font(.system(size: 11))
                    .foregroundStyle(theme.textGhost)
            }

            Spacer(minLength: Spacing.sm)

            Button {
                model.setDayDone(day.day, done: !day.done)
            } label: {
                Image(systemName: day.done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 15))
                    .foregroundStyle(day.done ? theme.accent : theme.textGhost)
                    .frame(width: 26, height: 26)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(model.isBusy)
            .help(day.done ? "Mark day \(day.day) unread" : "Mark day \(day.day) read")
            .accessibilityLabel("Mark day \(day.day) \(day.done ? "unread" : "read")")
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            isToday ? theme.accentSoft : theme.surface,
            in: .rect(cornerRadius: Radius.md)
        )
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
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)

                ForEach(model.presets) { preset in
                    presetCard(preset)
                }

                // Nothing to start and nothing that went wrong: the ⋯ menu is
                // not there without a plan and the error banner is not there
                // without an error, so this is the only way back.
                if model.presets.isEmpty && model.hasLoaded && model.error == nil {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                        Text("No plans came back from the server. Try again in a moment.")
                            .font(.system(size: 12))
                            .foregroundStyle(theme.textFaint)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: Spacing.sm)
                        Button("Try again") { model.reload() }
                            .buttonStyle(AccentButtonStyle())
                            .disabled(model.loading || model.isBusy)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                sectionLabel("BUILD MY OWN")
                builder
            }
            .padding(Spacing.xl)
            .frame(maxWidth: Layout.chooserWidth, alignment: .leading)
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
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(theme.text)
                    Spacer(minLength: Spacing.sm)
                    Text("\(preset.dayCount) days")
                        .font(.system(size: 11.5))
                        .monospacedDigit()
                        .foregroundStyle(theme.accent)
                    if model.activity == .starting(preset.key) {
                        ProgressView().controlSize(.small)
                    }
                }
                Text(preset.description)
                    .font(.system(size: 12.5))
                    .foregroundStyle(theme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.lg)
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(theme.border, lineWidth: 1)
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
                .textFieldStyle(.plain)
                .lineLimit(3...6)
                .font(.system(size: 13))
                .foregroundStyle(theme.text)
                .padding(Spacing.md)
                .background(theme.surface, in: .rect(cornerRadius: Radius.md))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.md)
                        .strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                .onChange(of: goal) { _, value in
                    if value.count > ReadingPlanModel.maxGoalLength {
                        goal = String(value.prefix(ReadingPlanModel.maxGoalLength))
                    }
                }
                .accessibilityLabel("What the plan should walk you through")

                HStack(spacing: Spacing.md) {
                    // `onIncrement`/`onDecrement` rather than `value:in:step:`,
                    // which refuses a step that would leave the range instead
                    // of clamping - so 365 was unreachable. See
                    // `ReadingPlanModel.adjustedGoalDays`.
                    Stepper {
                        Text("\(goalDays) days")
                            .font(.system(size: 13, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(theme.text)
                    } onIncrement: {
                        goalDays = ReadingPlanModel.adjustedGoalDays(
                            goalDays,
                            by: ReadingPlanModel.goalDayStep
                        )
                    } onDecrement: {
                        goalDays = ReadingPlanModel.adjustedGoalDays(
                            goalDays,
                            by: -ReadingPlanModel.goalDayStep
                        )
                    }
                    .accessibilityLabel("Plan length in days")

                    Spacer(minLength: Spacing.sm)

                    ForEach(ReadingPlanModel.goalDayChoices, id: \.self) { choice in
                        Button {
                            goalDays = choice
                        } label: {
                            Text("\(choice)")
                                .font(.system(size: 12, weight: goalDays == choice ? .bold : .regular))
                                .monospacedDigit()
                                .foregroundStyle(goalDays == choice ? theme.accent : theme.textMuted)
                                .frame(width: 40, height: 26)
                                .background(
                                    goalDays == choice ? theme.accentSoft : .clear,
                                    in: .capsule
                                )
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
                    submitGoal()
                } label: {
                    Text(model.isWriting ? "Writing your plan…" : "✦ Build my plan")
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(model.isBusy || goal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Text("A written plan takes up to two minutes - SureWord reads your study and lays out every day.")
                    .font(.system(size: 11))
                    .foregroundStyle(theme.textGhost)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func submitGoal() {
        let described = goal.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !described.isEmpty else { return }
        goal = ""
        model.startGoal(described, days: goalDays)
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .kerning(1.2)
            .foregroundStyle(theme.textFaint)
            .padding(.top, Spacing.sm)
    }
}

/// Wrapping row of chips. `Layout` rather than a `LazyVGrid` because the chips
/// are all different widths and a grid would column-align them.
private struct FlowRow: Layout {
    var spacing: CGFloat = Spacing.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = layout(subviews: subviews, width: width)
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(rows.count - 1, 0))
        let widest = rows.map(\.width).max() ?? 0
        return CGSize(width: min(width, max(widest, 0)), height: height)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var y = bounds.minY
        for row in layout(subviews: subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: x, y: y),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(size)
                )
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

    private func layout(subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let advance = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            if !row.indices.isEmpty, advance > width {
                rows.append(row)
                row = Row()
                row.indices = [index]
                row.width = size.width
                row.height = size.height
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

/// The plan's progress as a filled track. Definite height, no animation - the
/// reader's layout lesson applies here too.
private struct ProgressBar: View {
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
