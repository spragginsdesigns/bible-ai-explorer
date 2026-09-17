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
    /// The wording of the panel a thumbs down raises. It thanks first, because
    /// the rating is already recorded by the time it opens and nothing here is
    /// required of the user.
    static let reasonTitle = "Thanks for saying so"
    static let reasonPrompt = "What went wrong? Pick any that apply, add a note if you like."
    static let reasonPlaceholder = "Anything else? (optional)"
    /// The route answers 400 over this, so the body truncates rather than
    /// letting a long paste fail the whole rating.
    static let maxReasonLength = 500
}

/// The five reasons an answer can be wrong, as chips on "Not helpful".
///
/// A tag is a cheap, comparable signal the eval harness can group on, which a
/// free-text reason is not - so the chips carry the weight and the note beside
/// them stays optional.
///
/// **Every client keeps its own copy of this list** (there is no shared package
/// across the web, Android and Apple trees), and `tests/answer-feedback.test.mjs`
/// greps this file for each id and each label to keep the copies honest. Change
/// an id or a label here only together with `src/lib/chat/answer-feedback.ts`
/// and `mobile/src/lib/answerFeedback.ts`.
enum FeedbackTag: String, CaseIterable, Codable, Sendable {
    case notKJV = "not-kjv"
    case doctrine = "doctrine"
    case missedQuestion = "missed-question"
    case wrongVerse = "wrong-verse"
    case tooLong = "too-long"

    /// The chip's user-facing wording.
    var label: String {
        switch self {
        case .notKJV: "Not KJV"
        case .doctrine: "Doctrinally off"
        case .missedQuestion: "Missed my question"
        case .wrongVerse: "Wrong or missing verse"
        case .tooLong: "Too long"
        }
    }

    /// Draw order, which is declaration order. Named rather than reaching for
    /// `allCases` at each use site so the order is a decision this file records
    /// rather than a side effect of where a case happens to sit.
    static let ordered: [FeedbackTag] = allCases
}

/// What a "Not helpful" collected, once the user is done with the panel.
///
/// One value rather than two closure parameters because the two always travel
/// together, and because a thumb on its own passes `nil` - "the rating moved,
/// nothing was said" - which two optional parameters could not say as plainly.
struct AnswerFeedbackDetails: Sendable, Equatable {
    var reason: String?
    var tags: [FeedbackTag]

    init(reason: String? = nil, tags: [FeedbackTag] = []) {
        self.reason = reason
        self.tags = tags
    }
}

// MARK: - Wire types

/// Body of `PATCH /api/conversations/{id}/messages/{messageId}`.
///
/// A reason and its tags are only meaningful with `.down`, and the route ignores
/// either sent with anything else, so both are dropped here rather than sent to
/// be ignored.
struct AnswerFeedbackRequest: Sendable, Equatable, Encodable {
    var feedback: AnswerFeedback?
    var feedbackReason: String?
    var feedbackTags: [FeedbackTag]?

    init(feedback: AnswerFeedback?, reason: String? = nil, tags: [FeedbackTag] = []) {
        self.feedback = feedback
        let trimmed = reason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.feedbackReason =
            (feedback == .down && !trimmed.isEmpty)
                ? String(trimmed.prefix(AnswerFeedback.maxReasonLength))
                : nil
        // De-duplicated in draw order rather than sent twice: the route accepts
        // a repeat and stores it once, but the body should say what the user
        // chose, not how the chips were tapped.
        var seen = Set<FeedbackTag>()
        let unique = tags.filter { seen.insert($0).inserted }
        self.feedbackTags = (feedback == .down && !unique.isEmpty) ? unique : nil
    }

    private enum CodingKeys: String, CodingKey {
        case feedback, feedbackReason, feedbackTags
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
        // `encodeIfPresent` here, not `encode`: an omitted key already means
        // "no tags", and the init has nilled it for everything but a `.down`
        // that actually chose some.
        try container.encodeIfPresent(feedbackTags, forKey: .feedbackTags)
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
    /// Empty when the server has no tags for this row, or none this build knows.
    var feedbackTags: [FeedbackTag]
    var feedbackAt: String?

    private enum CodingKeys: String, CodingKey {
        case id, feedback, feedbackReason, feedbackTags, feedbackAt
    }

    init(
        id: String,
        feedback: AnswerFeedback?,
        feedbackReason: String? = nil,
        feedbackTags: [FeedbackTag] = [],
        feedbackAt: String? = nil
    ) {
        self.id = id
        self.feedback = feedback
        self.feedbackReason = feedbackReason
        self.feedbackTags = feedbackTags
        self.feedbackAt = feedbackAt
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? ""
        feedback = (try? container.decode(String.self, forKey: .feedback))
            .flatMap(AnswerFeedback.init(rawValue:))
        feedbackReason = try? container.decode(String.self, forKey: .feedbackReason)
        // Decoded as strings and narrowed, for the same reason `feedback` is: a
        // tag a later server adds must drop out of the list rather than fail a
        // request the user already saw succeed.
        feedbackTags = ((try? container.decode([String].self, forKey: .feedbackTags)) ?? [])
            .compactMap(FeedbackTag.init(rawValue:))
        feedbackAt = try? container.decode(String.self, forKey: .feedbackAt)
    }
}

// MARK: - API

enum AnswerFeedbackAPI {
    /// Rate, re-rate, or clear one assistant answer. `feedback: nil` clears every
    /// feedback column; `reason` and `tags` are carried only with `.down`.
    @discardableResult
    static func setAnswerFeedback(
        api: APIClient,
        conversationID: String,
        messageID: String,
        feedback: AnswerFeedback?,
        reason: String? = nil,
        tags: [FeedbackTag] = []
    ) async throws -> AnswerFeedbackResult {
        try await api.json(
            "/api/conversations/\(conversationID)/messages/\(messageID)",
            method: "PATCH",
            body: AnswerFeedbackRequest(feedback: feedback, reason: reason, tags: tags),
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

/// The panel a thumbs down raises: five chips, an optional note, Skip and Send.
/// Shared by both shells because the content is identical; only the presentation
/// differs (a popover off the Mac's action row, a sheet on the phone).
///
/// **It replaced a one-line `.alert` field.** An alert can hold a `TextField`
/// and nothing else, so the chips had nowhere to live - and a free-text reason
/// alone is a signal nobody can group on.
///
/// The draft lives in the presenting bubble rather than here, so that reopening
/// the panel for a different answer always starts empty rather than inheriting
/// whatever the last one was about.
struct FeedbackReasonSheet: View {
    @Environment(\.theme) private var theme

    /// The chips currently ticked. A set because the chips are a toggle each;
    /// `details` puts them back in draw order on the way out.
    @Binding var tags: Set<FeedbackTag>
    @Binding var reason: String
    /// Dismiss without saying more. The thumb is already recorded, so this has
    /// nothing to write.
    var onSkip: () -> Void
    var onSend: (AnswerFeedbackDetails) -> Void

    /// Nothing ticked and nothing typed is a Skip, so Send stays disabled rather
    /// than posting a second write that says exactly what the first one did.
    private var canSend: Bool {
        !tags.isEmpty || !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var details: AnswerFeedbackDetails {
        AnswerFeedbackDetails(
            reason: reason,
            tags: FeedbackTag.ordered.filter(tags.contains)
        )
    }

    var body: some View {
        #if os(macOS)
        // A popover is sized by its content, so the width is set here; the phone
        // gets the sheet's own width instead.
        panel.frame(width: 320, alignment: .leading)
        #else
        panel
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(theme.bgElevated)
            .presentationDetents([.medium])
            // The grab handle is what says the panel can be swiped away, which
            // is the Skip.
            .presentationDragIndicator(.visible)
        #endif
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(AnswerFeedback.reasonTitle)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)

            Text(AnswerFeedback.reasonPrompt)
                .font(.system(size: 13))
                .foregroundStyle(theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)

            FeedbackTagFlow(spacing: Spacing.sm) {
                ForEach(FeedbackTag.ordered, id: \.self) { tag in
                    chip(tag)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            noteField

            HStack(spacing: Spacing.sm) {
                Button("Skip", action: onSkip)
                    .buttonStyle(SubtleButtonStyle())
                    .foregroundStyle(theme.textMuted)
                    .font(.system(size: 13))

                Spacer(minLength: 0)

                Button("Send") { onSend(details) }
                    .buttonStyle(AccentButtonStyle())
                    .disabled(!canSend)
            }
        }
        .padding(Spacing.lg)
    }

    private var noteField: some View {
        TextField(AnswerFeedback.reasonPlaceholder, text: reasonBinding, axis: .vertical)
            .textFieldStyle(.plain)
            .lineLimit(1...3)
            .font(.system(size: 13))
            .foregroundStyle(theme.text)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .background(theme.surface, in: .rect(cornerRadius: Radius.md))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(theme.border, lineWidth: 1)
            }
    }

    /// One reason chip. Ticking is local until Send: the thumb was already
    /// written when the panel opened, and a chip is not worth a write per tap.
    @ViewBuilder
    private func chip(_ tag: FeedbackTag) -> some View {
        let chosen = tags.contains(tag)
        Button {
            if chosen {
                tags.remove(tag)
            } else {
                tags.insert(tag)
            }
        } label: {
            Text(tag.label)
                .font(.system(size: 12, weight: chosen ? .medium : .regular))
                .foregroundStyle(chosen ? theme.accent : theme.textSecondary)
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, 6)
                .background(
                    chosen ? theme.accentSoft : theme.surface,
                    in: .rect(cornerRadius: Radius.full)
                )
                .overlay {
                    Capsule()
                        .strokeBorder(chosen ? theme.accentBorder : theme.border, lineWidth: 1)
                }
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tag.label)
        // Colour alone says "chosen" to everyone else; VoiceOver needs it said.
        .accessibilityAddTraits(chosen ? [.isSelected] : [])
    }

    /// Clamps the note at the contract's 500 characters *as it is typed*, rather
    /// than quietly shortening what the user wrote when they press Send.
    private var reasonBinding: Binding<String> {
        Binding(
            get: { reason },
            set: { reason = String($0.prefix(AnswerFeedback.maxReasonLength)) }
        )
    }
}

/// Wrapping row of reason chips. `Layout` rather than a `LazyVGrid` because the
/// five labels are all different widths and a grid would column-align them.
///
/// A near-twin of `OriginalWordFlow` (`Shared/Bible/OriginalLanguageView.swift`),
/// which is file-private to a view this one cannot reach; the rows here are
/// always left-to-right, so its right-to-left half is left out.
private struct FeedbackTagFlow: Layout {
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
