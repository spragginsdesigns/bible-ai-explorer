import Foundation
import StoreKit
import StoreKitTest
import UIKit
import XCTest

@testable import SureWord

#if targetEnvironment(simulator)
/// Real local StoreKit transactions through the shipping purchase controller.
/// The HTTP verifier below is an explicit fake, never Apple's server or SureWord
/// production. Passing proves the client lifecycle, not real server entitlement.
///
/// Opt in on an owned, signed-out simulator with
/// TEST_RUNNER_SUREWORD_STOREKIT_LIFECYCLE=1 and select only this test class.
/// StoreKit test sessions change the host's local transaction history, so these
/// tests deliberately skip ordinary suites and refuse an attached real account.
@MainActor
final class StoreKitTransactionLifecycleTests: XCTestCase {
    private var session: SKTestSession!
    private var stores: [ProPurchaseStore] = []
    private var transports: [LocalStoreKitVerifier] = []
    private var finishBarriers: [TransactionFinishBarrier] = []
    private let userID = "storekit-lifecycle-owned-free-account"

    override func setUp() async throws {
        guard ProcessInfo.processInfo.environment["SUREWORD_STOREKIT_LIFECYCLE"] == "1" else {
            throw XCTSkip("Local transaction lifecycle is opt-in on an owned signed-out simulator.")
        }
        try requireSignedOutHost()
        let configuration = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("StoreKit/SureWord.storekit")
        session = try SKTestSession(contentsOf: configuration)
        session.resetToDefaultState()
        session.disableDialogs = true
        session.timeRate = .realTime
        session.clearTransactions()
    }

    override func tearDown() async throws {
        // The two startListening tests use private controllers. Shipping code
        // has no stop-listening seam; its weak-self tasks may wait until this
        // test host exits, but detach removes their API/account and invalidates
        // in-flight generations before the controllers are released.
        for barrier in finishBarriers { barrier.release() }
        finishBarriers.removeAll()
        for store in stores { store.detach() }
        stores.removeAll()
        session?.clearTransactions()
        session?.resetToDefaultState()
        session = nil
        for transport in transports { transport.close() }
        transports.removeAll()
    }

    func testPurchaseCarriesAccountTokenAndFinishesAfterSimulatedApproval() async throws {
        let (store, verifier) = try await preparedStore()
        let transaction = try await purchase(store)

        XCTAssertEqual(transaction.environment, .xcode)
        XCTAssertEqual(transaction.appAccountToken, AppAccountToken.forUser(userID))
        XCTAssertEqual(store.state.phase, .subscribed)
        let request = try XCTUnwrap(verifier.requests.last)
        XCTAssertEqual(request.transaction.transactionId, String(transaction.id))
        XCTAssertEqual(request.transaction.productId, AppStoreBilling.productID)
        XCTAssertEqual(request.transaction.appAccountToken, transaction.appAccountToken)
        XCTAssertEqual(request.transaction.environment, "Xcode")
        XCTAssertEqual(request.authorization, "Bearer local-fixture")
        XCTAssertEqual(request.status, 200)
        try await waitUntil("accepted purchase is finished") {
            !(await self.unfinishedIDs()).contains(transaction.id)
        }
    }

    func testStoreKitCancellationNeverVerifiesOrCreatesAnEntitlement() async throws {
        // The local SDK maps an injected generic userCancelled to ASD907 /
        // StoreKitError.unknown on iOS 27, before our handler sees a result.
        // Require an actual Cancel tap instead. The owning host runner must
        // retain this marker and drive only the native sheet's Cancel control;
        // never start another XCTest session against this running unit host.
        guard ProcessInfo.processInfo.environment["SUREWORD_STOREKIT_NATIVE_CANCEL"] == "1" else {
            throw XCTSkip("Native payment-sheet cancellation requires a separately owned UI driver.")
        }
        let (store, verifier) = try await preparedStore()
        session.disableDialogs = false
        let nonce = UUID().uuidString
        let marker = "QA_LOCAL_STOREKIT_CANCEL_READY: " + nonce + "\n"
        FileHandle.standardOutput.write(Data(marker.utf8))
        store.purchaseStarted()
        let result = try await purchaseResult(store)
        guard case .userCancelled = result else {
            return XCTFail("StoreKit must return the cancellation result")
        }
        await store.handle(result)

        XCTAssertEqual(store.state.phase, .ready)
        XCTAssertNil(store.state.message)
        XCTAssertTrue(verifier.requests.isEmpty)
        let entitlements = await entitlementIDs()
        XCTAssertTrue(entitlements.isEmpty)
        var completedTransactions: [UInt64] = []
        for await result in Transaction.all {
            if case .verified(let transaction) = result { completedTransactions.append(transaction.id) }
        }
        XCTAssertTrue(completedTransactions.isEmpty)
        FileHandle.standardOutput.write(Data(("QA_LOCAL_STOREKIT_CANCEL_PASSED: " + nonce + "\n").utf8))
    }

    func testAskToBuyWaitsThenApprovesThroughTransactionUpdates() async throws {
        let (store, verifier) = try await preparedStore()
        store.startListening()
        session.askToBuyEnabled = true
        store.purchaseStarted()
        let result = try await purchaseResult(store)
        guard case .pending = result else {
            return XCTFail("Ask to Buy must return pending before approval")
        }
        await store.handle(result)
        XCTAssertEqual(store.state.phase, .pending)
        XCTAssertTrue(verifier.requests.isEmpty)
        let beforeApproval = await entitlementIDs()
        XCTAssertTrue(beforeApproval.isEmpty)
        let pending = try XCTUnwrap(session.allTransactions().first(where: \.pendingAskToBuyConfirmation))
        try session.approveAskToBuyTransaction(identifier: pending.identifier)

        try await waitUntil("Ask to Buy approval activates the purchase controller") {
            store.state.phase == .subscribed && !verifier.requests.isEmpty
        }
        let approved = try XCTUnwrap(verifier.requests.last)
        XCTAssertEqual(approved.transaction.appAccountToken, AppAccountToken.forUser(userID))
        let approvedID = try XCTUnwrap(UInt64(approved.transaction.transactionId))
        try await waitUntil("approved transaction is finished") {
            !(await self.unfinishedIDs()).contains(approvedID)
        }
    }

    func testRestoreReverifiesAFinishedCurrentEntitlement() async throws {
        let (original, verifier) = try await preparedStore()
        let transaction = try await purchase(original)
        original.detach()
        // A new controller has no subscribed state to inherit. Attach's initial
        // reconciliation and Restore both use the actual StoreKit entitlement.
        let restored = makeStore(verifier: verifier, userID: userID)
        await restored.loadProduct()
        let beforeRestore = verifier.requests.count
        await restored.restore()

        XCTAssertEqual(restored.state.phase, .subscribed)
        XCTAssertEqual(restored.state.message, "Your SureWord Pro subscription is restored.")
        XCTAssertGreaterThan(verifier.requests.count, beforeRestore)
        XCTAssertEqual(verifier.requests.last?.transaction.transactionId, String(transaction.id))
    }

    func testRefundUpdateDropsActiveStateAndFinishesRevocation() async throws {
        let (store, verifier) = try await preparedStore()
        store.startListening()
        let transaction = try await purchase(store)
        try session.refundTransaction(identifier: UInt(transaction.id))

        try await waitUntil("refund update clears the active badge") {
            store.state.phase == .ready && verifier.requests.contains { $0.transaction.revocationDate != nil }
        }
        XCTAssertEqual(store.state.message, "That subscription is no longer active.")
        let refund = try XCTUnwrap(verifier.requests.last(where: { $0.transaction.revocationDate != nil }))
        XCTAssertEqual(refund.transaction.transactionId, String(transaction.id))
        XCTAssertEqual(refund.status, 200)
        try await waitUntil("definitive refund verification finishes its transaction") {
            !(await self.unfinishedIDs()).contains(transaction.id)
        }
        let entitlements = await entitlementIDs()
        XCTAssertFalse(entitlements.contains(transaction.id))
    }

    func testExpiredSubscriptionCannotRestorePro() async throws {
        let (store, _) = try await preparedStore()
        // Initialize an actually expired SDK transaction. Mutating a finished
        // purchase with expireSubscription can change the test server's date
        // while this SDK keeps the original future-dated signed entitlement.
        // A historical purchase avoids that stale mutation path without
        // constructing a fake Transaction or weakening the restore assertions.
        let historicalDate = Date().addingTimeInterval(-90 * 24 * 60 * 60)
        let transaction = try await session.buyProduct(
            identifier: AppStoreBilling.productID,
            options: [
                .appAccountToken(AppAccountToken.forUser(userID)),
                .purchaseDate(historicalDate, renewalBehavior: .cancelImmediately),
            ]
        )
        XCTAssertEqual(transaction.environment, .xcode)
        XCTAssertEqual(transaction.appAccountToken, AppAccountToken.forUser(userID))
        XCTAssertLessThanOrEqual(try XCTUnwrap(transaction.expirationDate), Date())
        try await waitUntil("expired subscription leaves current entitlements") {
            (await self.entitlementIDs()).isEmpty
        }
        var latestExpired: Transaction?
        try await waitUntil("StoreKit retains the verified expired transaction in history") {
            if let latest = await Transaction.latest(for: AppStoreBilling.productID),
               case .verified(let candidate) = latest, candidate.id == transaction.id {
                latestExpired = candidate
                return true
            }
            return false
        }
        let expired = try XCTUnwrap(latestExpired)
        XCTAssertEqual(expired.id, transaction.id)
        XCTAssertLessThanOrEqual(try XCTUnwrap(expired.expirationDate), Date())
        await store.restore()

        XCTAssertEqual(store.state.phase, .ready)
        XCTAssertEqual(store.state.message, "No active SureWord Pro subscription was found for this Apple Account.")
    }

    func testOfflinePurchaseRemainsUnfinishedAndControllerRecreationRetries() async throws {
        let (original, verifier) = try await preparedStore(mode: .offline)
        let transaction = try await purchase(original)
        XCTAssertEqual(original.state.phase, .ready)
        let unfinished = await unfinishedIDs()
        XCTAssertTrue(unfinished.contains(transaction.id), "An offline verify must not finish a paid transaction")
        XCTAssertTrue(verifier.requests.contains { $0.status == nil })
        original.detach()

        verifier.mode = .approve
        let relaunchedController = makeStore(verifier: verifier, userID: userID)
        try await waitUntil("a new controller retries persisted StoreKit work") {
            let unfinished = await self.unfinishedIDs()
            return relaunchedController.state.phase == .subscribed && !unfinished.contains(transaction.id)
        }
        XCTAssertEqual(verifier.requests.last?.transaction.transactionId, String(transaction.id))
        // This recreates the controller inside one test-host process. A killed
        // and relaunched app plus the Membership UI remains a separate journey.
    }

    func testAnotherAccountReceivesDefinitive403AndCannotClaimPurchase() async throws {
        let (original, verifier) = try await preparedStore(mode: .offline)
        let transaction = try await purchase(original)
        original.detach()

        let otherAccount = "storekit-lifecycle-different-account"
        verifier.expectedToken = AppAccountToken.forUser(otherAccount)
        verifier.mode = .approve
        let other = makeStore(verifier: verifier, userID: otherAccount)
        await other.loadProduct()
        await other.restore()

        XCTAssertEqual(other.state.phase, .ready)
        XCTAssertEqual(other.state.message, LocalStoreKitVerifier.bindingMessage)
        XCTAssertEqual(verifier.requests.last?.transaction.appAccountToken, AppAccountToken.forUser(userID))
        XCTAssertNotEqual(other.appAccountToken, transaction.appAccountToken)
        XCTAssertTrue(verifier.requests.contains { $0.status == 403 })
        XCTAssertFalse(verifier.requests.contains { $0.status == 200 })
        try await waitUntil("definitive account rejection finishes the transaction") {
            !(await self.unfinishedIDs()).contains(transaction.id)
        }
    }

    func testUnverifiableLocalTransactionStaysUnfinishedAndOffersRetry() async throws {
        let (store, verifier) = try await preparedStore(mode: .rejectLocalTransaction)
        let transaction = try await purchase(store)

        XCTAssertEqual(store.state.phase, .ready)
        XCTAssertEqual(store.state.message, LocalStoreKitVerifier.localRejectionMessage)
        XCTAssertEqual(verifier.requests.last?.status, 400)
        let unfinished = await unfinishedIDs()
        XCTAssertTrue(unfinished.contains(transaction.id))
        // The 400 is simulated. Production's Xcode rejection is independently
        // pinned by tests/app-store-billing.test.mjs; this never calls it.
    }

    func testFinishingOldAccountPurchaseCannotMutateNewAccount() async throws {
        let barrier = TransactionFinishBarrier()
        finishBarriers.append(barrier)
        let verifier = LocalStoreKitVerifier(expectedToken: AppAccountToken.forUser(userID), mode: .approve)
        transports.append(verifier)
        let store = ProPurchaseStore(finishTransaction: { transaction in
            // Reconciliation may see the same real transaction. Hold only
            // handle's turn so this race is tied to its post-approval await.
            if StoreKitAccountSwitchContext.isHandleTurn { await barrier.hold() }
            await transaction.finish()
        })
        stores.append(store)
        store.attach(api: verifier.api, userID: userID)
        defer {
            barrier.release()
            store.detach()
        }
        try await waitUntil("the account-switch test product loads", timeout: 30) {
            await store.loadProduct()
            return store.product != nil
        }
        store.purchaseStarted()
        let result = try await purchaseResult(store)
        guard case .success(.verified(let transaction)) = result else {
            throw LifecycleFailure("Expected a StoreKit-verified local purchase, got \(result)")
        }
        XCTAssertEqual(transaction.environment, .xcode)
        XCTAssertEqual(transaction.appAccountToken, AppAccountToken.forUser(userID))

        let handleTask = Task {
            await StoreKitAccountSwitchContext.$isHandleTurn.withValue(true) {
                await store.handle(result)
            }
        }
        defer {
            barrier.release()
            handleTask.cancel()
        }
        try await waitUntil("the approved handle turn pauses before finishing") { barrier.isHolding }
        XCTAssertTrue(verifier.requests.contains {
            $0.transaction.transactionId == String(transaction.id) && $0.status == 200
        })

        let otherAccount = "storekit-lifecycle-account-switched-during-finish"
        let otherVerifier = LocalStoreKitVerifier(expectedToken: AppAccountToken.forUser(otherAccount), mode: .offline)
        transports.append(otherVerifier)
        store.detach()
        store.attach(api: otherVerifier.api, userID: otherAccount)
        let resetState = store.state
        let resetToken = try XCTUnwrap(store.appAccountToken)
        XCTAssertEqual(resetState, PurchaseState())
        XCTAssertEqual(resetToken, AppAccountToken.forUser(otherAccount))
        XCTAssertNotEqual(resetToken, transaction.appAccountToken)
        try await waitUntil("the new account's private reconciliation stays offline") {
            !otherVerifier.requests.isEmpty
        }
        XCTAssertTrue(otherVerifier.requests.allSatisfy { $0.status == nil })

        barrier.release()
        await handleTask.value
        XCTAssertEqual(store.state, resetState, "An old approved turn must not apply success or retry state to the new account")
        XCTAssertEqual(store.appAccountToken, resetToken)
        try await waitUntil("the old account's definitively approved transaction still finishes") {
            !(await self.unfinishedIDs()).contains(transaction.id)
        }
    }

    private func requireSignedOutHost() throws {
        guard ProPurchaseStore.shared.appAccountToken == nil else {
            throw XCTSkip("Refusing local transactions while the shipping singleton has a signed-in account.")
        }
    }

    private func preparedStore(
        mode: LocalStoreKitVerifier.Mode = .approve
    ) async throws -> (ProPurchaseStore, LocalStoreKitVerifier) {
        let verifier = LocalStoreKitVerifier(expectedToken: AppAccountToken.forUser(userID), mode: mode)
        transports.append(verifier)
        let store = makeStore(verifier: verifier, userID: userID)
        try await waitUntil("the local StoreKit product loads", timeout: 30) {
            await store.loadProduct()
            return store.product != nil
        }
        return (store, verifier)
    }

    private func makeStore(verifier: LocalStoreKitVerifier, userID: String) -> ProPurchaseStore {
        let store = ProPurchaseStore()
        stores.append(store)
        store.attach(api: verifier.api, userID: userID)
        return store
    }

    @discardableResult
    private func purchase(_ store: ProPurchaseStore) async throws -> Transaction {
        try requireSignedOutHost()
        store.purchaseStarted()
        let result = try await purchaseResult(store)
        guard case .success(.verified(let transaction)) = result else {
            throw LifecycleFailure("Expected a StoreKit-verified local purchase, got \(result)")
        }
        await store.handle(result)
        return transaction
    }

    private func purchaseResult(_ store: ProPurchaseStore) async throws -> Product.PurchaseResult {
        try requireSignedOutHost()
        // The first hosted run logged a missing payment-sheet anchor. Supply
        // the app scene explicitly, as SwiftUI's shipping PurchaseAction does,
        // rather than relying on StoreKit to infer a presentation context.
        var scene: UIWindowScene?
        try await waitUntil("the local StoreKit host has a foreground-active scene", timeout: 15) {
            try self.requireSignedOutHost()
            scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .first(where: { $0.activationState == .foregroundActive })
            return scene != nil
        }
        return try await XCTUnwrap(store.product).purchase(
            confirmIn: try XCTUnwrap(scene), options: store.purchaseOptions)
    }

    private func unfinishedIDs() async -> Set<UInt64> {
        var ids: Set<UInt64> = []
        for await result in Transaction.unfinished {
            if case .verified(let transaction) = result { ids.insert(transaction.id) }
        }
        return ids
    }

    private func entitlementIDs() async -> Set<UInt64> {
        var ids: Set<UInt64> = []
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result { ids.insert(transaction.id) }
        }
        return ids
    }

    private func waitUntil(
        _ description: String,
        timeout: TimeInterval = 10,
        condition: @MainActor () async throws -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try await condition() { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw LifecycleFailure("Timed out: \(description)")
    }
}

private enum StoreKitAccountSwitchContext {
    @TaskLocal static var isHandleTurn = false
}

@MainActor
private final class TransactionFinishBarrier {
    private var continuation: CheckedContinuation<Void, Never>?
    private var released = false
    private(set) var isHolding = false

    func hold() async {
        guard !released else { return }
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            isHolding = true
        }
    }

    func release() {
        released = true
        isHolding = false
        let pending = continuation
        continuation = nil
        pending?.resume()
    }
}

private struct LifecycleFailure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

/// The fake records the actual JWS emitted by StoreKit and models only the
/// verify HTTP contract. Decoding the payload here is NOT signature validation.
/// StoreKit's VerificationResult is asserted by each purchase before this path.
private final class LocalStoreKitVerifier: @unchecked Sendable {
    enum Mode: Sendable { case approve, offline, rejectLocalTransaction }
    static let bindingMessage = "This App Store subscription belongs to another SureWord account."
    static let localRejectionMessage = "Local Xcode transactions cannot be verified here."

    struct TransactionPayload: Decodable, Sendable {
        let transactionId: String
        let productId: String
        let appAccountToken: UUID?
        let environment: String
        let expiresDate: Double
        let revocationDate: Double?
    }

    struct Request: Sendable {
        let transaction: TransactionPayload
        let authorization: String?
        let status: Int?
    }

    private let lock = NSLock()
    private var currentMode: Mode
    private var token: UUID
    private var recorded: [Request] = []
    private let host = "\(UUID().uuidString.lowercased()).storekit-verify.invalid"
    private var sessions: [URLSession] = []

    var mode: Mode {
        get { lock.withLock { currentMode } }
        set { lock.withLock { currentMode = newValue } }
    }
    var expectedToken: UUID {
        get { lock.withLock { token } }
        set { lock.withLock { token = newValue } }
    }
    var requests: [Request] { lock.withLock { recorded } }

    init(expectedToken: UUID, mode: Mode) {
        token = expectedToken
        currentMode = mode
        LocalStoreKitProtocol.registry.install(self, host: host)
    }

    var api: APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LocalStoreKitProtocol.self]
        let session = URLSession(configuration: configuration)
        lock.withLock { sessions.append(session) }
        return APIClient(
            baseURL: URL(string: "https://\(host)")!,
            token: { _ in "local-fixture" },
            onAuthFailure: {},
            session: session
        )
    }

    func close() {
        LocalStoreKitProtocol.registry.remove(host: host)
        for session in lock.withLock({ sessions }) { session.invalidateAndCancel() }
    }

    func respond(to request: URLRequest) throws -> (Int, Data) {
        guard request.url?.scheme == "https", request.url?.host == host,
              request.url?.path == AppStoreBilling.verifyPath, request.httpMethod == "POST" else {
            throw LifecycleFailure("The isolated verifier received an unexpected URL or method")
        }
        var body = request.httpBody
        if body == nil, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count >= 0 else { throw LifecycleFailure("Cannot read verify body") }
                if count == 0 { break }
                data.append(contentsOf: buffer.prefix(count))
            }
            body = data
        }
        let object = try JSONDecoder().decode([String: String].self, from: body ?? Data())
        guard object.count == 1, let signedTransaction = object["signedTransaction"] else {
            throw LifecycleFailure("The app did not send the verify route's signedTransaction body")
        }
        let segments = signedTransaction.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3, !segments[2].isEmpty else {
            throw LifecycleFailure("The app did not send StoreKit's compact JWS")
        }
        var base64 = String(segments[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let payload = Data(base64Encoded: base64) else { throw LifecycleFailure("Invalid JWS payload") }
        let transaction = try JSONDecoder().decode(TransactionPayload.self, from: payload)
        guard transaction.environment == "Xcode", transaction.productId == AppStoreBilling.productID else {
            throw LifecycleFailure("Only the configured Xcode-local SureWord product may enter this fake")
        }
        let (mode, expectedToken) = lock.withLock { (currentMode, token) }
        let status: Int?
        switch mode {
        case .offline: status = nil
        case .rejectLocalTransaction: status = 400
        case .approve: status = transaction.appAccountToken == expectedToken ? 200 : 403
        }
        lock.withLock {
            recorded.append(Request(transaction: transaction, authorization: request.value(forHTTPHeaderField: "Authorization"), status: status))
        }
        guard let status else { throw URLError(.notConnectedToInternet) }
        let response: [String: Any]
        if status == 403 { response = ["error": Self.bindingMessage] }
        else if status == 400 { response = ["error": Self.localRejectionMessage] }
        else {
            let active = transaction.revocationDate == nil && transaction.expiresDate > Date().timeIntervalSince1970 * 1000
            response = ["verified": true, "active": active, "status": active ? "active" : "expired"]
        }
        return (status, try JSONSerialization.data(withJSONObject: response))
    }
}

private final class LocalStoreKitProtocol: URLProtocol, @unchecked Sendable {
    final class Registry: @unchecked Sendable {
        private let lock = NSLock()
        private var verifiers: [String: LocalStoreKitVerifier] = [:]
        func install(_ verifier: LocalStoreKitVerifier, host: String) { lock.withLock { verifiers[host] = verifier } }
        func remove(host: String) { _ = lock.withLock { verifiers.removeValue(forKey: host) } }
        func verifier(host: String) -> LocalStoreKitVerifier? { lock.withLock { verifiers[host] } }
    }
    static let registry = Registry()

    // Claim every request in this private session, then reject unknown hosts.
    // Returning false for a bad URL would allow URLSession's real transport.
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let host = request.url?.host, host.hasSuffix(".storekit-verify.invalid"),
                  let verifier = Self.registry.verifier(host: host) else {
                throw URLError(.unsupportedURL)
            }
            let (status, body) = try verifier.respond(to: request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() {}
}
#endif
