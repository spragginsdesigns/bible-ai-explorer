import Testing
@testable import SureWord

@Suite("RetrievedVersesCard")
@MainActor
struct RetrievedVersesCardTests {
    @Test("Starts collapsed and expands only after user input")
    func startsCollapsed() {
        #expect(!RetrievedVersesCard.initiallyExpanded)
    }
}
