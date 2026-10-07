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
}
