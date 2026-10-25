import Foundation

/// The two "Quiz me" routes (`src/app/api/quiz/route.ts` and
/// `src/app/api/quiz/attempt/route.ts`), shapes in `QuizModels.swift`.
enum QuizAPI {
    /// A cache miss writes the quiz with a model, which takes 7 to 10 seconds
    /// and sometimes longer, so this is twice the REST budget.
    static let timeout: TimeInterval = 60

    /// What the screen shows when a quiz could not be loaded.
    struct LoadError: Error, Equatable {
        let message: String
    }

    static let unavailableMessage = "This quiz could not be written right now."

    private struct QuizRequest: Encodable {
        let book: Int
        let chapter: Int
        /// Omitted on the first load so the server picks the reader's default.
        let depth: QuizDepth?
        let modelId: String?
    }

    private struct ErrorBody: Decodable {
        let error: String?
    }

    /// `POST /api/quiz`. 400 and 403 carry text the reader should see (a bad
    /// reference, AI consent or a credential problem); 429 is the rate limit,
    /// also with its own text; anything else is the calm unavailable line.
    static func load(
        api: APIClient,
        book: Int,
        chapter: Int,
        depth: QuizDepth?,
        modelId: String?
    ) async throws -> ChapterQuiz {
        let status: Int
        let data: Data
        do {
            (status, data) = try await api.response(
                "/api/quiz",
                method: "POST",
                body: QuizRequest(book: book, chapter: chapter, depth: depth, modelId: modelId),
                timeout: timeout
            )
        } catch let error as APIError {
            throw LoadError(message: error.message)
        } catch {
            throw LoadError(message: APIError.offline.message)
        }
        return try interpret(status: status, data: data)
    }

    /// The response half of `load`, split out so it is testable offline.
    static func interpret(status: Int, data: Data) throws -> ChapterQuiz {
        if (200..<300).contains(status) {
            guard let quiz = try? JSONDecoder().decode(ChapterQuiz.self, from: data), !quiz.questions.isEmpty else {
                throw LoadError(message: unavailableMessage)
            }
            return quiz
        }
        let text = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        switch status {
        case 400, 403, 429:
            throw LoadError(message: (text?.isEmpty == false ? text : nil) ?? unavailableMessage)
        default:
            throw LoadError(message: unavailableMessage)
        }
    }

    /// `POST /api/quiz/attempt`, once per finished quiz. Failure is silent:
    /// the record only lets missed verses come back later.
    static func recordAttempt(api: APIClient, _ attempt: QuizAttemptInput) async {
        do {
            try await api.data("/api/quiz/attempt", method: "POST", body: attempt)
        } catch {
            // Deliberately quiet; the reader has their results either way.
        }
    }
}
