import SwiftUI

/// The user's own thumb on one settled assistant answer - the contract in
/// `docs/FEATURES.md` ("Answer feedback, and how it reaches the doctrinal eval
/// harness"). A thumb is a human judgment stored beside the answer in its own
/// columns, never folded into the mechanical eval score, and the user only ever
/// sees their own rating: there are no counts anywhere.
///
/// Raw values are exactly what goes on the wire, so a row decodes and a body
/// encodes without a translation table.

// MARK: - Model

enum AnswerFeedback: String, Sendable, Equatable, Codable {
    case up, down

    /// SF Symbol for the unchosen state.
    var symbol: String {
        switch self {
        case .up: "hand.thumbsup"
        case .down: "hand.thumbsdown"
        }
    }

    /// The filled variant, drawn once this thumb is the chosen one.
    var filledSymbol: String { "\(symbol).fill" }

    /// The wording the iOS context menu shows, and the accessibility label of
    /// the inline glyph on both platforms.
    var title: String {
        switch self {
        case .up: "Helpful"
        case .down: "Not helpful"
        }
    }
}

extension AnswerFeedback {
    /// The optional one-line reason, asked for only on "Not helpful".
    static let reasonPrompt = "What went wrong?"
    static let reasonPlaceholder = "Optional"
    /// The route answers 400 over this, so the body truncates rather than
    /// letting a long paste fail the whole rating.
    static let maxReasonLength = 500
}

// MARK: - Wire types

/// Body of `PATCH /api/conversations/{id}/messages/{messageId}`.
///
/// A reason is only meaningful with `.down`, and the route ignores one sent with
/// anything else, so it is dropped here rather than sent to be ignored.
struct AnswerFeedbackRequest: Sendable, Equatable, Encodable {
    var feedback: AnswerFeedback?
    var feedbackReason: String?

    init(feedback: AnswerFeedback?, reason: String? = nil) {
        self.feedback = feedback
        let trimmed = reason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.feedbackReason =
            (feedback == .down && !trimmed.isEmpty)
                ? String(trimmed.prefix(AnswerFeedback.maxReasonLength))
                : nil
    }

    private enum CodingKeys: String, CodingKey {
        case feedback, feedbackReason
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Explicit `encode` (not `encodeIfPresent`) so clearing a rating posts
        // `"feedback": null`. Dropping the key instead would read as "leave it
        // alone" and the thumb would never come off. Same reason
        // `AppendToNoteRequest` encodes its `noteId` this way
        // (`Shared/Chat/AddToNote.swift:90`).
        try container.encode(feedback, forKey: .feedback)
        try container.encodeIfPresent(feedbackReason, forKey: .feedbackReason)
    }
}

/// Response shape of the same route: the updated row.
///
/// Decoded leniently - an older server that does not know the columns yet, or a
/// `feedback` string this build has no case for, must not fail the request the
/// user already saw succeed optimistically.
struct AnswerFeedbackResult: Sendable, Equatable, Decodable {
    var id: String
    var feedback: AnswerFeedback?
    var feedbackReason: String?
    var feedbackAt: String?

    private enum CodingKeys: String, CodingKey {
        case id, feedback, feedbackReason, feedbackAt
    }

    init(id: String, feedback: AnswerFeedback?, feedbackReason: String? = nil, feedbackAt: String? = nil) {
        self.id = id
        self.feedback = feedback
        self.feedbackReason = feedbackReason
        self.feedbackAt = feedbackAt
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? ""
        feedback = (try? container.decode(String.self, forKey: .feedback))
            .flatMap(AnswerFeedback.init(rawValue:))
        feedbackReason = try? container.decode(String.self, forKey: .feedbackReason)
        feedbackAt = try? container.decode(String.self, forKey: .feedbackAt)
    }
}

// MARK: - API

enum AnswerFeedbackAPI {
    /// Rate, re-rate, or clear one assistant answer. `feedback: nil` clears all
    /// three columns; `reason` is carried only with `.down`.
    @discardableResult
    static func setAnswerFeedback(
        api: APIClient,
        conversationID: String,
        messageID: String,
        feedback: AnswerFeedback?,
        reason: String? = nil
    ) async throws -> AnswerFeedbackResult {
        try await api.json(
            "/api/conversations/\(conversationID)/messages/\(messageID)",
            method: "PATCH",
            body: AnswerFeedbackRequest(feedback: feedback, reason: reason),
            as: AnswerFeedbackResult.self
        )
    }
}

// MARK: - View

/// The two quiet thumbs that sit beside "Add to notes" on a settled answer.
/// Shared by both shells for the same reason `ReceiptLineView` is: the control
/// is identical, and only where the reason is asked for differs.
///
/// Purely presentational. Tapping the chosen thumb again reports `nil`, which is
/// the clear; the caller decides whether a `.down` needs the reason field first.
struct AnswerFeedbackButtons: View {
    @Environment(\.theme) private var theme

    let feedback: AnswerFeedback?
    /// `nil` clears the rating.
    var onSelect: (AnswerFeedback?) -> Void

    var body: some View {
        HStack(spacing: 0) {
            thumb(.up)
            thumb(.down)
        }
    }

    @ViewBuilder
    private func thumb(_ choice: AnswerFeedback) -> some View {
        let chosen = feedback == choice
        Button {
            onSelect(chosen ? nil : choice)
        } label: {
            Image(systemName: chosen ? choice.filledSymbol : choice.symbol)
                .font(.system(size: 12))
                .foregroundStyle(chosen ? theme.accent : theme.textFaint)
        }
        .buttonStyle(SubtleButtonStyle())
        .accessibilityLabel(choice.title)
    }
}
