import Foundation

/// Public activity snapshot shared by the web, Android and Swift clients.
struct ChatProgress: Sendable, Equatable {
    struct Entry: Sendable, Equatable, Identifiable {
        struct Source: Sendable, Equatable, Identifiable {
            var title: String
            var url: URL
            var id: String { url.absoluteString }
        }
        var id: String
        var kind: String
        var state: String
        var label: String
        var detail: String?
        var sources: [Source]
    }
    var runId: String
    var sequence: Double
    var elapsedMs: Double
    var lastActivityMs: Double
    var state: String
    var phase: String
    var label: String
    var entries: [Entry]

    init?(_ value: JSONValue) {
        guard value["version"]?.doubleValue == 1,
              let runId = value["runId"]?.stringValue,
              let sequence = value["sequence"]?.doubleValue, sequence.isFinite,
              let elapsed = value["elapsedMs"]?.doubleValue, elapsed.isFinite,
              let lastActivity = value["lastActivityMs"]?.doubleValue, lastActivity.isFinite,
              let state = value["state"]?.stringValue, ["running", "complete", "error"].contains(state),
              let phase = value["phase"]?.stringValue, ["preparing", "thinking", "tool", "answering"].contains(phase),
              let label = value["label"]?.stringValue,
              let rawEntries = value["entries"]?.arrayValue else { return nil }
        self.runId = runId
        self.sequence = max(0, sequence)
        elapsedMs = max(0, elapsed)
        lastActivityMs = max(0, lastActivity)
        self.state = state
        self.phase = phase
        self.label = String(label.prefix(180))
        entries = rawEntries.suffix(48).compactMap { raw in
            guard let id = raw["id"]?.stringValue,
                  let kind = raw["kind"]?.stringValue, ["tool", "summary", "status"].contains(kind),
                  let state = raw["state"]?.stringValue, ["running", "complete", "error", "interrupted"].contains(state),
                  let label = raw["label"]?.stringValue else { return nil }
            let sources: [Entry.Source] = (raw["sources"]?.arrayValue ?? []).prefix(6).compactMap { source in
                guard let title = source["title"]?.stringValue,
                      let text = source["url"]?.stringValue, let url = URL(string: text),
                      ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
                      url.host != nil, url.user == nil, url.password == nil else { return nil }
                return Entry.Source(title: String(title.prefix(100)), url: url)
            }
            return Entry(id: String(id.prefix(120)), kind: kind, state: state, label: String(label.prefix(180)),
                         detail: raw["detail"]?.stringValue.map { String($0.prefix(2400)) }, sources: sources)
        }
    }

    static func duration(_ ms: Double) -> String {
        let seconds = Int(min(86_400_000, max(0, ms.isFinite ? ms : 0)) / 1000)
        return seconds >= 60 ? "\(seconds / 60)m \(seconds % 60)s" : "\(seconds)s"
    }
}
