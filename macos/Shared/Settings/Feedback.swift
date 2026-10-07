import SwiftUI

// MARK: - Rules

/// Settings -> Send feedback (docs/FEATURES.md, "Send feedback"): the Apple
/// mirror of `mobile/src/lib/inAppFeedback.ts`, which mirrors the server's
/// `src/lib/feedback/in-app-feedback.ts`.
///
/// The server owns the rules. This copy exists so the screen can show the same
/// chips and stop an obviously empty or oversized message before it costs a
/// round trip; `FeedbackTests` pins the ids, labels and limits to the server's
/// file, because a chip the server has never heard of is a 400 the person
/// reads as "it broke".
enum InAppFeedback {
    struct Category: Identifiable, Equatable, Sendable {
        let id: String
        let label: String
    }

    static let categories: [Category] = [
        Category(id: "bug", label: "Something is broken"),
        Category(id: "idea", label: "I have an idea"),
        Category(id: "praise", label: "Something I love"),
        Category(id: "other", label: "Something else"),
    ]

    static let maxMessageLength = 2000
    static let maxReplyEmailLength = 254

    static let path = "/api/feedback"

    /// The longest prefix that fits `maxMessageLength` UTF-16 units without
    /// splitting a character.
    static func clamp(_ text: String) -> String {
        var units = 0
        var end = text.startIndex
        for index in text.indices {
            let next = units + text[index].utf16.count
            if next > maxMessageLength { break }
            units = next
            end = text.index(after: index)
        }
        return String(text[..<end])
    }

    /// Shape only, and only to spare a round trip; the server decides.
    static func looksLikeEmail(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= maxReplyEmailLength else { return false }
        return trimmed.wholeMatch(of: /[^\s@]+@[^\s@]+\.[^\s@]+/) != nil
    }

    /// `POST /api/feedback`'s body, with the optional keys left out when empty
    /// exactly as Android spreads them in.
    struct Body: Encodable, Equatable, Sendable {
        var category: String
        var message: String
        var appVersion: String?
        var replyEmail: String?

        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(category, forKey: .category)
            try container.encode(message, forKey: .message)
            try container.encodeIfPresent(appVersion, forKey: .appVersion)
            try container.encodeIfPresent(replyEmail, forKey: .replyEmail)
        }

        private enum CodingKeys: String, CodingKey { case category, message, appVersion, replyEmail }
    }

    /// What Send does with what was typed, or why it will not.
    enum Draft: Equatable {
        case empty
        case badEmail
        case ready(Body)
    }

    static func draft(category: String, message: String, replyEmail: String, appVersion: String?) -> Draft {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .empty }
        let email = replyEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        if !email.isEmpty, !looksLikeEmail(email) { return .badEmail }
        return .ready(
            Body(
                category: category,
                message: trimmed,
                appVersion: appVersion.flatMap { $0.isEmpty ? nil : $0 },
                replyEmail: email.isEmpty ? nil : email
            )
        )
    }
}

protocol FeedbackTransport: Sendable {
    func sendFeedback(_ body: InAppFeedback.Body) async throws
}

extension APIClient: FeedbackTransport {
    func sendFeedback(_ body: InAppFeedback.Body) async throws {
        try await data(InAppFeedback.path, method: "POST", body: body)
    }
}

// MARK: - Model

/// Drives the Send feedback screen on both Apple clients - the state machine
/// of Android's `FeedbackSection.tsx`.
@MainActor
@Observable
final class FeedbackModel {
    var category = "bug"
    var message = "" {
        didSet {
            // UTF-16 units, the unit the server's `message.length` counts and
            // Android's `maxLength` enforces; a grapheme count would let an
            // emoji-heavy message past this check and into a 400.
            if message.utf16.count > InAppFeedback.maxMessageLength {
                message = InAppFeedback.clamp(message)
            }
            error = nil
        }
    }
    var replyEmail = "" { didSet { error = nil } }
    private(set) var isSending = false
    private(set) var isSent = false
    private(set) var error: String?

    private let appVersion: String?

    init(appVersion: String? = Config.appVersion) {
        self.appVersion = appVersion
    }

    var canSend: Bool {
        !isSending && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var counter: String { "\(message.utf16.count) / \(InAppFeedback.maxMessageLength)" }

    func send(using transport: any FeedbackTransport) async {
        guard !isSending else { return }
        switch InAppFeedback.draft(category: category, message: message, replyEmail: replyEmail, appVersion: appVersion) {
        case .empty:
            return
        case .badEmail:
            error = "That email address does not look right."
        case .ready(let body):
            isSending = true
            error = nil
            defer { isSending = false }
            do {
                try await transport.sendFeedback(body)
                isSent = true
                message = ""
                replyEmail = ""
            } catch {
                self.error = (error as? APIError)?.message ?? "Could not send that. Try again."
            }
        }
    }

    func startOver() {
        isSent = false
    }
}

// MARK: - View

/// The Send feedback form, shared by iOS (pushed from Settings) and macOS
/// (a sheet over Settings). Copy is Android's, word for word.
struct FeedbackView: View {
    @Environment(\.theme) private var theme
    let api: APIClient
    @State private var model = FeedbackModel()

    var body: some View {
        Form {
            if model.isSent {
                Section {
                    Text(
                        "Thank you. That went straight through, and it is read by a person rather than counted by a machine."
                    )
                    .foregroundStyle(theme.text)
                    Button("Send something else") { model.startOver() }
                }
            } else {
                Section {
                    Text(
                        "Tell us what is broken, what is missing, or what you would want SureWord to do. A person reads every one of these."
                    )
                    .font(.footnote)
                    .foregroundStyle(theme.textMuted)

                    Picker("Kind of feedback", selection: $model.category) {
                        ForEach(InAppFeedback.categories) { option in
                            Text(option.label).tag(option.id)
                        }
                    }
                    #if os(iOS)
                    .pickerStyle(.inline)
                    #else
                    .pickerStyle(.radioGroup)
                    #endif
                    .labelsHidden()
                }

                Section {
                    ZStack(alignment: .topLeading) {
                        if model.message.isEmpty {
                            Text("The Listen button never finished loading for me this morning…")
                                .foregroundStyle(theme.textGhost)
                                .padding(.top, 8)
                                .padding(.leading, 5)
                                .allowsHitTesting(false)
                        }
                        TextEditor(text: $model.message)
                            .frame(minHeight: 140)
                            .scrollContentBackground(.hidden)
                            .accessibilityLabel("Your feedback")
                    }

                    TextField("Email, only if you want a reply", text: $model.replyEmail)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        #endif
                        .accessibilityLabel("Email, only if you want a reply")
                } footer: {
                    HStack {
                        if let error = model.error {
                            Text(error).foregroundStyle(theme.danger)
                        } else if model.isSending {
                            Text("Sending…")
                        }
                        Spacer()
                        Text(model.counter).monospacedDigit()
                    }
                    .font(.caption)
                    .foregroundStyle(theme.textGhost)
                }

                Section {
                    Button {
                        Task { await model.send(using: api) }
                    } label: {
                        Text(model.isSending ? "Sending…" : "Send")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(!model.canSend)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Send feedback")
        .analyticsScreen(AnalyticsScreen.feedback)
    }
}
