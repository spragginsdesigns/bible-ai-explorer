import XCTest

@testable import SureWord

/// A1: the iOS Settings -> Account -> Delete account row sends exactly what
/// `DELETE /api/account` demands. The deletion model's status handling is
/// shared code and covered in `SureWordTests/AccountDeletionTests.swift`.
final class AccountDeletionRequestTests: XCTestCase {
    func testDeleteAccountRequestMethodPathAndBody() async throws {
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
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.absoluteString, "https://example.test/api/account")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer jwt")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-sureword-client"), "ios")
        XCTAssertEqual(request.httpBody.map { String(decoding: $0, as: UTF8.self) }, #"{"confirm":"DELETE"}"#)
    }

    /// A 503 is refused before anything ran, so it reads like a 500.
    @MainActor
    func testServiceUnavailableSaysNothingWasRemoved() async {
        let model = AccountDeletionModel()
        let deleted = await model.delete(using: FailingTransport(error: .server(status: 503)))
        XCTAssertFalse(deleted)
        XCTAssertEqual(model.errorMessage, AccountDeletionModel.failedNothingRemoved)
        XCTAssertFalse(model.mayHaveDeleted)
    }

    /// Deletion never cancels an App Store subscription, and the confirmation
    /// says so (the server must not block deletion over it, 5.1.1(v)).
    func testConfirmationWarnsThatAppStoreSubscriptionsStayActive() {
        XCTAssertEqual(
            AccountDeletion.appStoreNotice,
            "Subscribed through the App Store? Deleting your account does not cancel it. "
                + "Cancel SureWord Pro in your Apple ID settings first."
        )
        XCTAssertEqual(AccountDeletion.manageSubscriptionsURL.absoluteString, "https://apps.apple.com/account/subscriptions")
    }
}

private struct FailingTransport: AccountDeletionTransport {
    let error: APIError
    func deleteAccount() async throws { throw error }
}
