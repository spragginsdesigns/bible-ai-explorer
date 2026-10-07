import Foundation
import Testing
@testable import SureWord

/// A1: Settings -> Account -> Delete account. Pins the request the route
/// demands (`src/app/api/account/route.ts`) and how each status it can answer
/// is read by the shared deletion model.
@Suite("Account deletion")
@MainActor
struct AccountDeletionTests {

    @Test("Builds DELETE /api/account with exactly the confirm body and the bearer")
    func buildsRequest() async throws {
        let client = APIClient(
            baseURL: URL(string: "https://example.test")!,
            token: { _ in "jwt" },
            onAuthFailure: {}
        )
        let request = try await client.makeRequest(
            AccountDeletion.path,
            method: AccountDeletion.method,
            body: AccountDeletion.Body(),
            fresh: false
        )
        #expect(request.httpMethod == "DELETE")
        #expect(request.url?.absoluteString == "https://example.test/api/account")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer jwt")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.value(forHTTPHeaderField: "x-sureword-client") == "macos")
        let body = try #require(request.httpBody)
        #expect(String(decoding: body, as: UTF8.self) == #"{"confirm":"DELETE"}"#)
    }

    @Test("A 200 means deleted")
    func successDeletes() async {
        let model = AccountDeletionModel()
        let deleted = await model.delete(using: FakeTransport([nil]))
        #expect(deleted)
        #expect(model.phase == .deleted)
    }

    @Test("A 500 says nothing was removed")
    func serverFailureKeepsEverything() async {
        let model = AccountDeletionModel()
        let deleted = await model.delete(using: FakeTransport([.server(status: 500)]))
        #expect(!deleted)
        #expect(model.errorMessage == AccountDeletionModel.failedNothingRemoved)
        #expect(!model.mayHaveDeleted)
    }

    @Test("A 502 is retryable, and a retry that succeeds finishes")
    func clerkFailureRetries() async {
        let model = AccountDeletionModel()
        let transport = FakeTransport([.server(status: 502), nil])
        #expect(await model.delete(using: transport) == false)
        #expect(model.errorMessage == AccountDeletionModel.failedRetryable)
        model.dismissError()
        #expect(await model.delete(using: transport))
        #expect(model.phase == .deleted)
    }

    @Test("A 401 after an attempt that may have gone through counts as done")
    func unauthorizedAfterPossibleSuccessIsDone() async {
        let model = AccountDeletionModel()
        let transport = FakeTransport([.timedOut, .server(status: 401)])
        #expect(await model.delete(using: transport) == false)
        #expect(model.mayHaveDeleted)
        model.dismissError()
        #expect(await model.delete(using: transport))
        #expect(model.phase == .deleted)
    }

    @Test("A 401 on the first attempt is a session problem, not a deletion")
    func unauthorizedFirstIsNotDone() async {
        let model = AccountDeletionModel()
        #expect(await model.delete(using: FakeTransport([.server(status: 401)])) == false)
        #expect(model.errorMessage == AccountDeletionModel.failedSession)
    }
}

/// Answers each call with the next scripted outcome (nil = 200).
private final class FakeTransport: AccountDeletionTransport, @unchecked Sendable {
    private var outcomes: [APIError?]
    init(_ outcomes: [APIError?]) { self.outcomes = outcomes }

    func deleteAccount() async throws {
        let next = outcomes.isEmpty ? nil : outcomes.removeFirst()
        if let next { throw next }
    }
}
