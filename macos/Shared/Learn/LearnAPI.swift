import Foundation

/// The Learn endpoints - a port of `mobile/src/features/learn/api.ts` and the
/// add call in `AddLearnButton.tsx`. The same routes serve every client, so a
/// verse added on the phone is practised here and vice versa.
enum LearnAPI {
    /// Where an add came from - the route's `source` enum. Recorded only.
    enum Source: String, Encodable, Sendable {
        case sheet, highlight, chat, suggestion
    }

    private struct AddBody: Encodable {
        let book: Int
        let chapter: Int
        let verse: Int
        let translation: String
        let source: Source
    }

    static func today(api: APIClient) async throws -> LearnToday {
        let data = try await api.data("/api/learn/today")
        return try JSONDecoder().decode(LearnToday.self, from: data)
    }

    /// Suggested verses. Never throws: a failure is "no suggestions today".
    static func suggestions(api: APIClient) async -> [LearnSuggestion] {
        guard let value = try? await api.json("/api/learn/suggestions", as: JSONValue.self) else { return [] }
        return LearnSuggestions.parse(value)
    }

    /// `POST /api/learn`: idempotent on the verse, so a second tap returns the
    /// card as it stands (200) instead of resetting its schedule.
    static func add(
        api: APIClient,
        book: Int,
        chapter: Int,
        verse: Int,
        translation: String,
        source: Source
    ) async throws -> LearnCard {
        let data = try await api.data(
            "/api/learn",
            method: "POST",
            body: AddBody(book: book, chapter: chapter, verse: verse, translation: translation, source: source)
        )
        let card = try JSONDecoder().decode(LearnCard.self, from: data)
        guard card.book == book, card.chapter == chapter, card.verse == verse else {
            throw LearnParseError(message: "Unexpected verse")
        }
        return card
    }

    /// `POST /api/learn/:id/review`, mapping the statuses the sync store acts
    /// on into `LearnReviewFailure`, exactly as `reviewLearnCard` does.
    static func review(
        api: APIClient,
        cardID: String,
        payload: LearnReviewOperation
    ) async throws -> LearnReviewAcknowledgement {
        let id = cardID.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? cardID
        let status: Int
        let data: Data
        do {
            (status, data) = try await api.response("/api/learn/\(id)/review", method: "POST", body: payload)
        } catch let error as APIError {
            throw LearnReviewFailure(message: error.message, offline: error.isOffline)
        } catch {
            throw LearnReviewFailure(message: "You appear to be offline.", offline: true)
        }
        return try interpret(status: status, data: data, operationID: payload.operationId)
    }

    /// The response half of `reviewLearnCard`, split out so it is testable
    /// without a network.
    static func interpret(status: Int, data: Data, operationID: String) throws -> LearnReviewAcknowledgement {
        if (200..<300).contains(status) {
            let acknowledgement = try JSONDecoder().decode(LearnReviewAcknowledgement.self, from: data)
            try acknowledgement.validate(expectedOperationID: operationID)
            return acknowledgement
        }
        let body = try? JSONDecoder().decode(JSONValue.self, from: data)
        if status == 409, let raw = body?["code"]?.stringValue,
           let code = LearnConflictCode(rawValue: raw), code != .missing {
            var currentCard: LearnCard?
            if let card = body?["currentCard"], card != .null {
                let cardData = try JSONEncoder().encode(card)
                currentCard = try JSONDecoder().decode(LearnCard.self, from: cardData)
            }
            throw LearnReviewFailure(
                message: body?["error"]?.stringValue ?? raw,
                code: code,
                currentCard: currentCard
            )
        }
        if status == 404 {
            throw LearnReviewFailure(message: "This verse is no longer on the server.", code: .missing, currentCard: nil)
        }
        throw LearnReviewFailure(message: body?["error"]?.stringValue ?? "Review failed: \(status)")
    }
}
