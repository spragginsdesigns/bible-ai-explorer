import Foundation

/// The static six: shown to a brand-new account, and whenever generation fails.
/// Mirrors `src/utils/commonQuestions.ts` and
/// `mobile/src/features/chat/commonQuestions.ts`.
enum CommonQuestions {
    static let all: [String] = [
        "What is the story of creation?",
        "What is the purpose of life according to the Bible?",
        "Where was Jesus born?",
        "What does the Bible say about forgiveness?",
        "What does it mean to be born again?",
        "How should I pray according to Scripture?",
    ]
}

enum SuggestedQuestionsAPI {
    /// The route allows itself 60s; the screen should not wait that long to
    /// fall back to the static six.
    static let timeout: TimeInterval = 25

    static func load(api: APIClient) async throws -> [SuggestedQuestionInput] {
        try await api.json("/api/suggested-questions", timeout: timeout, as: Response.self).inputs
    }

    /// `GET /api/suggested-questions` answers
    /// `{ questions: string[], items: { question, label }[], personalized }`.
    /// `items` carries the gold label web and Android render; `questions` is the
    /// plain array kept for clients installed before labels existed, in the same
    /// order. Prefer `items`, fall back to `questions` - port of
    /// `parseSuggestedQuestionsResponse` in `src/utils/questionPresentation.ts`.
    struct Response: Decodable {
        let inputs: [SuggestedQuestionInput]

        private enum Keys: String, CodingKey {
            case items
            case questions
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Keys.self)
            let items = ((try? container.decode([Entry].self, forKey: .items)) ?? [])
                .compactMap(\.value)
            if !items.isEmpty {
                inputs = items
                return
            }
            inputs = ((try? container.decode([Entry].self, forKey: .questions)) ?? [])
                .compactMap(\.value)
        }
    }

    /// One array entry, tolerating everything the TS parser tolerates: the
    /// current object shape, a bare string from an older deploy, and any
    /// malformed entry, which is skipped rather than failing the whole payload.
    private struct Entry: Decodable {
        let value: SuggestedQuestionInput?

        private enum Keys: String, CodingKey {
            case question
            case label
        }

        init(from decoder: any Decoder) throws {
            if let single = try? decoder.singleValueContainer(),
               let text = try? single.decode(String.self) {
                value = text.isEmpty ? nil : SuggestedQuestionInput(question: text, label: nil)
                return
            }
            guard let keyed = try? decoder.container(keyedBy: Keys.self),
                  let question = try? keyed.decode(String.self, forKey: .question),
                  !question.isEmpty
            else {
                value = nil
                return
            }
            let label = try? keyed.decode(String.self, forKey: .label)
            value = SuggestedQuestionInput(
                question: question,
                label: (label?.isEmpty == false) ? label : nil
            )
        }
    }

    /// Test seam: decode a raw payload exactly as `load` would.
    static func parse(_ data: Data) -> [SuggestedQuestionInput] {
        ((try? JSONDecoder().decode(Response.self, from: data)) ?? Response(inputs: [])).inputs
    }
}

extension SuggestedQuestionsAPI.Response {
    /// Direct construction for the empty/failed case; `Decodable` supplies the
    /// real one.
    init(inputs: [SuggestedQuestionInput]) {
        self.inputs = inputs
    }
}

/// The personalized questions on the empty chat screen, drawn from this user's
/// own reading, questions, notes, memories and today's cross.
///
/// Owned by `AppModel`, which is rebuilt on every sign-in - so the cache is
/// per-account for free, and one generation covers the whole session however
/// many times the user starts a new chat. Port of the `useSuggestedQuestions`
/// hooks on web and Android.
@MainActor
@Observable
final class SuggestedQuestionsModel {
    /// Never empty: the static six until this user's own arrive. Each carries
    /// the gold caption the welcome chips render above the question.
    private(set) var questions: [SuggestedQuestionItem] =
        QuestionPresentation.buildItems(CommonQuestions.all)
    private(set) var isLoading = false

    private let api: APIClient
    /// Only a success settles it, so a failed attempt is retried the next time
    /// the welcome screen appears rather than pinning the static six for good.
    private var hasLoaded = false

    init(api: APIClient) {
        self.api = api
    }

    func load() {
        guard !hasLoaded, !isLoading else { return }
        isLoading = true
        Task {
            let loaded = (try? await SuggestedQuestionsAPI.load(api: api)) ?? []
            if !loaded.isEmpty {
                questions = QuestionPresentation.buildItems(loaded)
                hasLoaded = true
            }
            isLoading = false
        }
    }
}
