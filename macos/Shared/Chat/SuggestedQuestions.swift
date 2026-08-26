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

    static func load(api: APIClient) async throws -> [String] {
        try await api.json("/api/suggested-questions", timeout: timeout, as: Response.self).questions
    }

    /// The route also sends `items` - the same questions carrying the gold
    /// label Android and web render. macOS/iOS do not show it yet, so only the
    /// plain `questions` array is decoded here.
    private struct Response: Decodable {
        let questions: [String]
    }
}

/// The personalized questions on the empty chat screen, drawn from this user's
/// own reading, questions, notes, memories and today's cross.
///
/// Owned by `AppModel`, which is rebuilt on every sign-in — so the cache is
/// per-account for free, and one generation covers the whole session however
/// many times the user starts a new chat. Port of the `useSuggestedQuestions`
/// hooks on web and Android.
@MainActor
@Observable
final class SuggestedQuestionsModel {
    /// Never empty: the static six until this user's own arrive.
    private(set) var questions: [String] = CommonQuestions.all
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
                questions = loaded
                hasLoaded = true
            }
            isLoading = false
        }
    }
}
