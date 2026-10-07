import XCTest

@testable import SureWord

/// The shared StoreKit billing code compiles and agrees with the server on the
/// macOS build too (the Mac shows no purchase UI). Full coverage lives in
/// `SureWord-iOSTests/StoreKitBillingTests.swift`.
final class AppAccountTokenTests: XCTestCase {
    func testAppAccountTokenMatchesServerFixedVector() {
        XCTAssertEqual(
            AppAccountToken.forUser("user_2abcDEFghiJKLmnoPQRstu").uuidString.lowercased(),
            "b6ef9ddb-a89c-561d-9a09-9e5fbddc845c"
        )
    }

    func testRetryableAnswersLeaveTheTransactionUnfinished() {
        XCTAssertFalse(AppStoreBilling.VerifyOutcome.from(response: nil, failureStatus: 503, message: nil).shouldFinish)
        XCTAssertTrue(AppStoreBilling.VerifyOutcome.from(response: nil, failureStatus: 403, message: nil).shouldFinish)
    }
}
