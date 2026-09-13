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
                .background(theme.surface, in: RoundedRectangle(cornerRadius: 16))
                .overlay { RoundedRectangle(cornerRadius: 16).stroke(theme.accentBorder, lineWidth: 1) }
            }
            if expanded {
                VStack(alignment: .leading, spacing: 12) {
                    if progress.entries.isEmpty { Text("No additional activity to show yet.") }
                    ForEach(progress.entries) { entry in
                        DisclosureGroup {
                            if let detail = entry.detail {
                                Text(detail.replacingOccurrences(of: "**", with: ""))
                                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                            }
                            ForEach(entry.sources) { source in
                                Link(source.title, destination: source.url).frame(minHeight: 44)
                            }
                        } label: {
                            Label(entry.label, systemImage: entry.state == "error" ? "exclamationmark.circle" : entry.kind == "summary" ? "sparkles" : entry.state == "running" ? "ellipsis" : entry.kind == "status" || entry.state == "interrupted" ? "minus" : "checkmark")
                                .frame(minHeight: 44).fixedSize(horizontal: false, vertical: true)
                        }
                        .tint(theme.textMuted)
                        .padding(.horizontal, entry.kind == "summary" ? 12 : 0)
                        .padding(.vertical, entry.kind == "summary" ? 5 : 0)
                        .background(entry.kind == "summary" ? theme.surface : .clear, in: RoundedRectangle(cornerRadius: 12))
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
