import Testing
@testable import SureWord

struct GuidePhaseTests {
    @Test func thinkingRequiresAnActiveAnswerWithoutVisibleText() {
        #expect(GuidePhase.resolve(streaming: true, content: " \n\t") == .thinking)
        #expect(GuidePhase.resolve(streaming: true, content: "Grace") == .answering)
        #expect(GuidePhase.resolve(streaming: false, content: "Grace") == .idle)
        #expect(GuidePhase.resolve(streaming: false, content: "") == .idle)
    }

    @Test func fallbackQuestionsKeepTheirCrossPlatformReferences() {
        #expect(CommonQuestions.suggestions.map(\.question) == CommonQuestions.all)
        #expect(CommonQuestions.suggestions.map(\.label) == ["Genesis 1", "Ecclesiastes 12:13", "Luke 2:7", "Ephesians 4:32", "John 3:3", "Matthew 6:9"])
    }
}
