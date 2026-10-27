import SwiftUI

/// Settings -> Shared answers -> Cards you sent (`docs/FEATURES.md`, "Share
/// cards" -> "Send a word"): every personal card this account sent, with Copy
/// link and Revoke. Revoking makes the card's page and image answer 404 at
/// once; a picture already saved by whoever received it is out of reach.
/// Mirrors `mobile/src/features/shareCards/SentCardsSection.tsx` and the web's
/// `src/components/settings/SentCardsSection.tsx`.
///
/// Like `SharedAnswersSectionView` the view owns its own `Section`, so the
/// macOS form and the iOS Shared answers page register it with one line each.

// MARK: - API

extension APIClient {
    /// The owner's own sent cards. There is no public index of them.
    func listSentCards() async throws -> [SentCardRow] {
        try await json("/api/cards/personal", as: SentCardsResponse.self).cards
    }

    /// Take a card back. The row is stamped, not deleted, so the list still
    /// shows what was sent.
    func revokeSentCard(id: String) async throws {
        try await data("/api/cards/personal/\(ShareCards.pathSegment(id))", method: "DELETE")
    }
}

// MARK: - Model

@MainActor
@Observable
final class SentCardsModel {
    static let revokeTitle = "Take this card back?"
    static let revokeMessage = "Its link and picture stop working for everyone right away."

    private(set) var cards: [SentCardRow] = []
    private(set) var hasLoaded = false
    private(set) var loadError: String?
    /// The row with a DELETE in flight. One at a time, as on Android, so a
    /// second tap cannot race the first.
    private(set) var revokingID: String?
    var errorAlert: SharedAnswersModel.ErrorAlert?

    private var api: APIClient?

    func configure(_ api: APIClient) {
        if self.api == nil { self.api = api }
    }

    func load() async {
        guard let api else { return }
        do {
            cards = try await api.listSentCards()
            loadError = nil
        } catch {
            loadError = "Couldn't load your cards."
        }
        hasLoaded = true
    }

    /// Not optimistic, as on Android: the row only reads "Revoked" once the
    /// server has taken the card back, because a card that still opens must
    /// never look revoked.
    func revoke(_ card: SentCardRow) async {
        guard let api, revokingID == nil, !card.isRevoked else { return }
        revokingID = card.id
        defer { revokingID = nil }
        do {
            try await api.revokeSentCard(id: card.id)
            if let index = cards.firstIndex(where: { $0.id == card.id }) {
                cards[index].revokedAt = ISO8601DateFormatter().string(from: Date())
            }
        } catch {
            errorAlert = SharedAnswersModel.ErrorAlert(
                title: "Couldn't revoke",
                message: "Check your connection and try again."
            )
        }
    }
}

// MARK: - View

struct SentCardsSectionView: View {
    @Environment(\.theme) private var theme

    @Bindable var model: SentCardsModel

    /// The row whose link was just copied, so the confirmation lands on it.
    @State private var copiedID: String?
    @State private var pendingRevoke: SentCardRow?

    static let description = "Words you sent to someone. Revoke one to take its link and picture back."
    static let emptyState = "Cards you send appear here."

    var body: some View {
        Section("Cards you sent") {
            hint(Self.description)
                .alert(
                    model.errorAlert?.title ?? "",
                    isPresented: Binding(
                        get: { model.errorAlert != nil },
                        set: { if !$0 { model.errorAlert = nil } }
                    ),
                    presenting: model.errorAlert
                ) { _ in
                    Button("OK", role: .cancel) {}
                } message: { alert in
                    Text(alert.message)
                }
                .confirmationDialog(
                    SentCardsModel.revokeTitle,
                    isPresented: Binding(
                        get: { pendingRevoke != nil },
                        set: { if !$0 { pendingRevoke = nil } }
                    ),
                    titleVisibility: .visible,
                    presenting: pendingRevoke
                ) { card in
                    Button("Revoke", role: .destructive) {
                        Task { await model.revoke(card) }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: { _ in
                    Text(SentCardsModel.revokeMessage)
                }
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        if let loadError = model.loadError, model.cards.isEmpty {
            HStack(spacing: Spacing.md) {
                Text(loadError)
                    .appFont(.system(size: 12))
                    .foregroundStyle(theme.danger)
                Spacer()
                Button("Retry") { Task { await model.load() } }
                    .accessibilityLabel("Retry loading your cards")
            }
        } else if !model.hasLoaded {
            HStack(spacing: Spacing.sm) {
                ProgressView().controlSize(.small)
                Text("Loading your cards\u{2026}")
                    .appFont(.system(size: 12))
                    .foregroundStyle(theme.textMuted)
                Spacer()
            }
        } else if model.cards.isEmpty {
            hint(Self.emptyState)
        } else {
            ForEach(model.cards) { card in
                row(card)
            }
        }
    }

    private func row(_ card: SentCardRow) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(card.title)
                .appFont(.system(size: 13))
                .foregroundStyle(card.isRevoked ? theme.textMuted : theme.text)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: Spacing.sm) {
                if let createdAt = card.createdAt, !MemoryFormat.relativeTime(createdAt).isEmpty {
                    Text(MemoryFormat.relativeTime(createdAt))
                        .appFont(.system(size: 11))
                        .foregroundStyle(theme.textGhost)
                }
                if card.isRevoked {
                    Text("Revoked")
                        .appFont(.system(size: 10, weight: .bold))
                        .kerning(0.6)
                        .foregroundStyle(theme.textMuted)
                }
                Spacer()
                // A revoked card no longer opens, so neither action is offered:
                // copying a dead link is a trap.
                if !card.isRevoked {
                    Button(copiedID == card.id ? "Link copied" : "Copy link") {
                        copy(card)
                    }
                    .buttonStyle(SubtleButtonStyle())
                    .appFont(.system(size: 11))
                    .foregroundStyle(theme.textMuted)
                    .accessibilityLabel("Copy this card's link")

                    Button("Revoke") { pendingRevoke = card }
                        .buttonStyle(SubtleButtonStyle())
                        .appFont(.system(size: 11))
                        .foregroundStyle(theme.danger)
                        .disabled(model.revokingID != nil)
                        .accessibilityLabel("Revoke this card")
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func copy(_ card: SentCardRow) {
        SharedAnswerPasteboard.copy(card.url)
        copiedID = card.id
        Task {
            try? await Task.sleep(for: .seconds(2))
            // Only clear our own confirmation: a later copy owns the label now.
            if copiedID == card.id { copiedID = nil }
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .appFont(.system(size: 11))
            .foregroundStyle(theme.textGhost)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
