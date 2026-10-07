import SwiftUI

struct WorkActivityView: View {
    @Environment(\.theme) private var theme
    let progress: ChatProgress
    let isStreaming: Bool
    @State private var expanded = false
    @State private var receivedAt = Date.now
    private var live: Bool { isStreaming && progress.state == "running" }

    var body: some View {
        Group {
            if live {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    activity(elapsed: progress.elapsedMs + max(0, context.date.timeIntervalSince(receivedAt) * 1000))
                }
            } else {
                activity(elapsed: progress.elapsedMs)
            }
        }
        .onChange(of: progress.sequence) { receivedAt = .now }
        // A new run restarts the clock too, as Android's effect keys on runId.
        .onChange(of: progress.runId) { receivedAt = .now }
    }

    private func title(_ elapsed: Double) -> String {
        let duration = ChatProgress.duration(elapsed)
        if live { return "Working for \(duration)" }
        if progress.state == "error" { return "Interrupted after \(duration)" }
        if progress.state == "running" { return "Updates stopped after \(duration)" }
        return "Worked for \(duration)"
    }

    private func activity(elapsed: Double) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { expanded.toggle() } label: {
                HStack(spacing: 8) {
                    if live { ProgressView().controlSize(.small) }
                    Text(title(elapsed))
                    Image(systemName: expanded ? "chevron.up" : "chevron.down").font(.system(size: 11))
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.textMuted)
            .accessibilityLabel(title(elapsed))
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")

            if live, progress.phase != "answering" {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Activity", systemImage: "sparkles")
                        .font(.system(size: 13)).foregroundStyle(theme.accentDim)
                    Text(progress.label).font(.system(size: 15)).foregroundStyle(theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    if elapsed - progress.lastActivityMs >= 20_000 {
                        Text("Still waiting for the response. No new update yet.").foregroundStyle(theme.textMuted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                // Android's polite live region: VoiceOver hears the new step.
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.updatesFrequently)
                .background(theme.surface, in: RoundedRectangle(cornerRadius: 16))
                .overlay { RoundedRectangle(cornerRadius: 16).stroke(theme.accentBorder, lineWidth: 1) }
            }
            if expanded {
                VStack(alignment: .leading, spacing: 12) {
                    if progress.entries.isEmpty { Text("No additional activity to show yet.") }
                    ForEach(progress.entries) { entry in
                        WorkActivityEntryRow(
                            entry: entry,
                            current: live && progress.entries.last?.id == entry.id
                        )
                    }
                }
                .foregroundStyle(theme.textMuted)
                .padding(.leading, 10)
                .overlay(alignment: .leading) { Rectangle().fill(theme.border).frame(width: 1) }
            }
        }
        .font(.system(size: 14))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One step in the expanded history. Port of Android's `ActivityEntry`
/// (`WorkActivity.tsx`): a step with nothing behind it is not a button and has
/// no chevron, and the step running right now shows the first three lines of
/// its detail without being opened.
struct WorkActivityEntryRow: View {
    @Environment(\.theme) private var theme
    let entry: ChatProgress.Entry
    let current: Bool
    @State private var expanded = false

    private var hasDetails: Bool { entry.detail != nil || !entry.sources.isEmpty }

    /// Kind before state, in Android's order: a status line is an outline
    /// circle even while it runs, and only an interrupted step gets the minus.
    static func symbol(kind: String, state: String) -> String {
        if state == "error" { return "exclamationmark.circle" }
        if kind == "summary" { return "sparkles" }
        if kind == "status" { return "circle" }
        if state == "running" { return "ellipsis" }
        if state == "interrupted" { return "minus" }
        return "checkmark"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Button {
                expanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: Self.symbol(kind: entry.kind, state: entry.state))
                        .font(.system(size: 13))
                    Text(entry.label)
                        .fixedSize(horizontal: false, vertical: true)
                    if hasDetails {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11))
                    }
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!hasDetails)
            .accessibilityLabel(entry.label)
            .accessibilityValue(hasDetails ? (expanded ? "Expanded" : "Collapsed") : "")

            if let detail = entry.detail, expanded || current {
                Text(detail.replacingOccurrences(of: "**", with: ""))
                    .lineLimit(expanded ? nil : 3)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if expanded {
                ForEach(entry.sources) { source in
                    Link(source.title, destination: source.url).frame(minHeight: 44)
                }
            }
        }
        .tint(theme.textMuted)
        .padding(.horizontal, entry.kind == "summary" ? 12 : 0)
        .padding(.vertical, entry.kind == "summary" ? 5 : 0)
        .background(entry.kind == "summary" ? theme.surface : .clear, in: RoundedRectangle(cornerRadius: 12))
    }
}
