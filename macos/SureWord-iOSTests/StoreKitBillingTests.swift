import StoreKit
import StoreKitTest
import SwiftUI
import UIKit
import XCTest

@testable import SureWord

/// StoreKit 2 billing (PRD F2): the account token matches the server, the
/// verify request has the route's shape, server answers map to finish/retry
/// correctly, the Membership offer never sells Pro twice, and the purchase
/// reducer. StoreKit itself is not exercised here.
final class StoreKitBillingTests: XCTestCase {
    // MARK: - appAccountToken

    func testAppAccountTokenMatchesServerFixedVector() {
        // Same vectors as tests/app-store-billing.test.mjs (and Python's uuid5).
        XCTAssertEqual(
            AppAccountToken.namespace.uuidString.lowercased(),
            "2f58cff8-d92f-43e2-93d6-d21633bffbe5"
        )
        XCTAssertEqual(
            AppAccountToken.forUser("user_2abcDEFghiJKLmnoPQRstu").uuidString.lowercased(),
            "b6ef9ddb-a89c-561d-9a09-9e5fbddc845c"
        )
        XCTAssertEqual(
            AppAccountToken.forUser("user_x").uuidString.lowercased(),
            "693f7414-5fdc-5367-b107-2bdcf533e9c5"
        )
        XCTAssertNotEqual(AppAccountToken.forUser("a"), AppAccountToken.forUser("b"))
    }

    // MARK: - Verify request

    func testVerifyRequestMethodPathAndBody() async throws {
        let client = APIClient(
            baseURL: URL(string: "https://example.test")!,
            token: { _ in "jwt" },
            onAuthFailure: {}
        )
        let request = try await client.makeRequest(
            AppStoreBilling.verifyPath,
            method: "POST",
            body: AppStoreBilling.VerifyRequest(signedTransaction: "h.p.s"),
            fresh: false
        )
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.absoluteString, "https://example.test/api/billing/app-store/verify")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer jwt")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(request.httpBody.map { String(decoding: $0, as: UTF8.self) }, #"{"signedTransaction":"h.p.s"}"#)
        XCTAssertEqual(AppStoreBilling.productID, "com.spragginsdesigns.sureword.pro.monthly")
    }

    func testVerifyResponseDecodes() throws {
        let json = #"{"verified":true,"active":true,"status":"active","expiresAt":"2026-11-07T12:00:00.000Z"}"#
        let response = try JSONDecoder().decode(AppStoreBilling.VerifyResponse.self, from: Data(json.utf8))
        XCTAssertEqual(AppStoreBilling.VerifyOutcome.from(response: response, failureStatus: nil, message: nil), .accepted(active: true))
    }

    // MARK: - finish() only on a definitive answer

    func testOnlyDefinitiveAnswersFinishTheTransaction() {
        let accepted = AppStoreBilling.VerifyOutcome.from(
            response: .init(verified: true, active: false, status: "expired", expiresAt: nil),
            failureStatus: nil, message: nil
        )
        XCTAssertEqual(accepted, .accepted(active: false))
        XCTAssertTrue(accepted.shouldFinish)

        let otherAccount = AppStoreBilling.VerifyOutcome.from(response: nil, failureStatus: 403, message: "belongs to another account")
        XCTAssertEqual(otherAccount, .belongsToAnotherAccount("belongs to another account"))
        XCTAssertTrue(otherAccount.shouldFinish)

        for status in [400, 401, 500, 503, nil] as [Int?] {
            let outcome = AppStoreBilling.VerifyOutcome.from(response: nil, failureStatus: status, message: nil)
            XCTAssertFalse(outcome.shouldFinish, "status \(String(describing: status)) must leave the transaction unfinished")
        }
    }

    // MARK: - Offer

    private func membership(plan: String, owner: Bool = false, provider: String? = nil, available: Bool? = true) throws -> MembershipResponse {
        var object: [String: Any] = [
            "plan": plan, "owner": owner, "enabled": true, "access": "house", "hasPersonalKeys": false,
        ]
        if let provider { object["subscription"] = ["status": "active", "provider": provider, "periodEnd": "2026-11-07T00:00:00.000Z", "cancelAtPeriodEnd": false] }
        if let available { object["appStoreCheckoutAvailable"] = available }
        return try JSONDecoder().decode(MembershipResponse.self, from: JSONSerialization.data(withJSONObject: object))
    }

    func testOfferNeverSellsProTwice() throws {
        XCTAssertEqual(AppStoreBilling.offer(for: try membership(plan: "pro", provider: "stripe")), .activeElsewhere)
        XCTAssertEqual(AppStoreBilling.offer(for: try membership(plan: "pro", provider: "google-play")), .activeElsewhere)
        XCTAssertEqual(AppStoreBilling.offer(for: try membership(plan: "pro")), .activeElsewhere, "allowlist Pro")
        XCTAssertEqual(AppStoreBilling.offer(for: try membership(plan: "free", owner: true)), .activeElsewhere)
        XCTAssertEqual(AppStoreBilling.offer(for: try membership(plan: "pro", provider: "app_store")), .activeHere)
        XCTAssertEqual(AppStoreBilling.offer(for: try membership(plan: "free")), .purchasable)
        XCTAssertEqual(AppStoreBilling.offer(for: try membership(plan: "free", available: false)), .unavailable)
        XCTAssertEqual(AppStoreBilling.offer(for: try membership(plan: "free", available: nil)), .unavailable, "older server")
    }

    // MARK: - StoreKit configuration

    /// The scheme's local StoreKit configuration really defines the product
    /// the app asks for, as a 1-month auto-renewable in "SureWord Pro".
    @MainActor
    func testLocalStoreKitConfigurationSellsTheProduct() async throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("StoreKit/SureWord.storekit")
        let session = try SKTestSession(contentsOf: url)
        session.disableDialogs = true
        session.clearTransactions()
        // A freshly booted simulator's StoreKit daemon can answer the first
        // request with nothing while it loads the session; retry briefly.
        var products: [Product] = []
        for _ in 0..<10 where products.isEmpty {
            products = try await Product.products(for: [AppStoreBilling.productID])
            if products.isEmpty { try await Task.sleep(for: .milliseconds(500)) }
        }
        let product = try XCTUnwrap(products.first)
        XCTAssertEqual(product.id, AppStoreBilling.productID)
        XCTAssertEqual(product.type, .autoRenewable)
        XCTAssertEqual(product.price, Decimal(string: "14.99"))
        XCTAssertEqual(product.subscription?.subscriptionPeriod.unit, .month)
        XCTAssertEqual(product.subscription?.subscriptionPeriod.value, 1)
        XCTAssertFalse(product.displayPrice.isEmpty)
    }

    /// Writes `docs/ios/evidence/storekit/membership-dark.png`: the real
    /// Membership screen over the local StoreKit configuration, as a free
    /// account. Opt-in (it writes into the repo):
    /// `TEST_RUNNER_SUREWORD_STOREKIT_EVIDENCE=1 xcodebuild test ...`.
    @MainActor
    func testMembershipScreenEvidence() async throws {
        guard ProcessInfo.processInfo.environment["SUREWORD_STOREKIT_EVIDENCE"] == "1" else {
            throw XCTSkip("Evidence capture is opt-in.")
        }
        let repoMacos = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let session = try SKTestSession(contentsOf: repoMacos.appendingPathComponent("StoreKit/SureWord.storekit"))
        session.disableDialogs = true
        session.clearTransactions()

        let app = AppModel(settings: SettingsStore(), userID: nil)
        let store = ProPurchaseStore.shared
        store.attach(api: app.api, userID: "evidence-user")
        for _ in 0..<10 where store.product == nil {
            await store.loadProduct()
            if store.product == nil { try await Task.sleep(for: .milliseconds(500)) }
        }
        let product = try XCTUnwrap(store.product)
        XCTAssertEqual(product.displayPrice, "$14.99")

        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let output = repoMacos.deletingLastPathComponent().appendingPathComponent("docs/ios/evidence/storekit")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let free = try membership(plan: "free")
        // One window, dark: a second window in the same run hung the
        // simulator's test host, so light mode is not captured here.
        let window = UIWindow(windowScene: scene)
        window.frame = scene.screen.bounds
        window.overrideUserInterfaceStyle = .dark
        window.rootViewController = UIHostingController(
            rootView: NavigationStack { ProMembershipView(membership: free) }
                .environment(app)
                .preferredColorScheme(.dark)
        )
        window.makeKeyAndVisible()
        try await Task.sleep(for: .seconds(2))
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        try XCTUnwrap(image.pngData()).write(to: output.appendingPathComponent("membership-dark.png"))
        window.isHidden = true
        store.detach()
    }

    // MARK: - Reducer

    func testPurchaseHappyPath() {
        var state = PurchaseState()
        state = .reduce(state, .loadStarted)
        XCTAssertEqual(state.phase, .loadingProduct)
        XCTAssertTrue(state.isBusy)
        state = .reduce(state, .productLoaded(displayPrice: "$14.99"))
        XCTAssertEqual(state.phase, .ready)
        XCTAssertEqual(state.displayPrice, "$14.99")
        XCTAssertTrue(state.canPurchase)
        state = .reduce(state, .purchaseStarted)
        XCTAssertEqual(state.phase, .purchasing)
        state = .reduce(state, .verifying)
        XCTAssertEqual(state.phase, .verifying)
        state = .reduce(state, .verified(.accepted(active: true)))
        XCTAssertEqual(state.phase, .subscribed)
        XCTAssertFalse(state.isBusy)
        // A later product reload never knocks a subscribed screen back to "ready".
        XCTAssertEqual(PurchaseState.reduce(state, .loadStarted).phase, .subscribed)
    }

    func testCancelPendingAndFailures() {
        let ready = PurchaseState.reduce(PurchaseState(), .productLoaded(displayPrice: "$14.99"))
        XCTAssertEqual(PurchaseState.reduce(PurchaseState.reduce(ready, .purchaseStarted), .userCancelled).phase, .ready)
        let pending = PurchaseState.reduce(ready, .pending)
        XCTAssertEqual(pending.phase, .pending)
        XCTAssertNotNil(pending.message)
        let retry = PurchaseState.reduce(ready, .verified(.retryLater("try later")))
        XCTAssertEqual(retry.phase, .ready)
        XCTAssertEqual(retry.message, "try later")
        let elsewhere = PurchaseState.reduce(ready, .verified(.belongsToAnotherAccount("another account")))
        XCTAssertEqual(elsewhere.message, "another account")
        XCTAssertEqual(PurchaseState.reduce(PurchaseState(), .productUnavailable).phase, .unavailable)
        XCTAssertEqual(PurchaseState.reduce(PurchaseState(), .failed("x")).phase, .unavailable)
    }

    func testRestore() {
        let ready = PurchaseState.reduce(PurchaseState(), .productLoaded(displayPrice: "$14.99"))
        let restoring = PurchaseState.reduce(ready, .restoreStarted)
        XCTAssertEqual(restoring.phase, .restoring)
        XCTAssertTrue(restoring.isBusy)
        XCTAssertEqual(PurchaseState.reduce(restoring, .restoreFinished(anyActive: true, note: nil)).phase, .subscribed)
        let none = PurchaseState.reduce(restoring, .restoreFinished(anyActive: false, note: nil))
        XCTAssertEqual(none.phase, .ready)
        XCTAssertEqual(none.message, "No active SureWord Pro subscription was found for this Apple Account.")
        let noted = PurchaseState.reduce(restoring, .restoreFinished(anyActive: false, note: "belongs to another account"))
        XCTAssertEqual(noted.message, "belongs to another account")
    }
}
