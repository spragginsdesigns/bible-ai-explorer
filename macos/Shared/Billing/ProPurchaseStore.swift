import Foundation
import Observation
import StoreKit

/// SureWord Pro through StoreKit 2 - the iOS purchase path. Compiled on macOS
/// too (shared code), but only the iOS app starts it or shows its UI: the Mac
/// App Store is not a distribution channel.
///
/// The contract with the server (`POST /api/billing/app-store/verify`):
/// - every purchase carries `appAccountToken` = `AppAccountToken.forUser`,
///   which is what binds it to this SureWord account server-side;
/// - each verified transaction's `jwsRepresentation` is posted to the server,
///   and `finish()` is called only on a definitive answer
///   (`AppStoreBilling.VerifyOutcome.shouldFinish`). Anything else stays
///   unfinished, so StoreKit redelivers it and the next sign-in retries.
@MainActor
@Observable
final class ProPurchaseStore {
    static let shared = ProPurchaseStore()

    private(set) var state = PurchaseState()
    private(set) var product: Product?

    @ObservationIgnored private var api: APIClient?
    @ObservationIgnored private var userID: String?
    @ObservationIgnored private var updates: Task<Void, Never>?
    /// Bumped on every attach/detach so a request that started for one
    /// account never lands its result on the next.
    @ObservationIgnored private var generation = 0

    /// Called at app launch. Renewals, Ask to Buy approvals, refunds and
    /// purchases made on another device arrive here.
    func startListening() {
        guard updates == nil else { return }
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                await self?.process(result)
            }
        }
    }

    /// Called when an account signs in: verifies anything StoreKit is still
    /// holding (unfinished transactions, current entitlements) for it.
    func attach(api: APIClient, userID: String) {
        generation += 1
        self.api = api
        self.userID = userID
        state = PurchaseState()
        Task { await reconcile() }
    }

    /// Called on sign-out. Unfinished transactions stay with StoreKit and are
    /// verified when an account next signs in.
    func detach() {
        generation += 1
        api = nil
        userID = nil
        state = PurchaseState()
    }

    var appAccountToken: UUID? { userID.map(AppAccountToken.forUser) }

    // MARK: - Product

    func loadProduct() async {
        if let product {
            apply(.productLoaded(displayPrice: product.displayPrice))
            return
        }
        apply(.loadStarted)
        do {
            let products = try await Product.products(for: [AppStoreBilling.productID])
            if let found = products.first(where: { $0.id == AppStoreBilling.productID }) {
                product = found
                apply(.productLoaded(displayPrice: found.displayPrice))
            } else {
                apply(.productUnavailable)
            }
        } catch {
            apply(.productUnavailable)
        }
    }

    // MARK: - Purchase

    /// Options for SwiftUI's `PurchaseAction`, which the view calls (it knows
    /// the scene to present Apple's payment sheet in).
    var purchaseOptions: Set<Product.PurchaseOption> {
        guard let token = appAccountToken else { return [] }
        return [.appAccountToken(token)]
    }

    func purchaseStarted() { apply(.purchaseStarted) }

    /// Handles what the payment sheet returned.
    func handle(_ result: Product.PurchaseResult) async {
        switch result {
        case .success(let verification):
            apply(.verifying)
            let outcome = await process(verification)
            apply(.verified(outcome ?? .retryLater("Your purchase couldn't be confirmed yet. SureWord will try again shortly.")))
        case .userCancelled:
            apply(.userCancelled)
        case .pending:
            apply(.pending)
        @unknown default:
            apply(.failed("The App Store returned an unexpected result. Please try again."))
        }
    }

    func purchaseFailed(_ error: any Error) {
        apply(.failed("The purchase didn't go through. \(error.localizedDescription)"))
    }

    // MARK: - Restore

    /// Restore Purchases: `AppStore.sync()` (which may ask for the Apple
    /// Account password), then re-verify current entitlements.
    func restore() async {
        apply(.restoreStarted)
        do {
            try await AppStore.sync()
        } catch {
            // A cancelled sign-in still lets the local entitlements be checked.
        }
        let (anyActive, note) = await verifyCurrentEntitlements()
        apply(.restoreFinished(anyActive: anyActive, note: note))
    }

    // MARK: - Verification

    private func reconcile() async {
        for await result in Transaction.unfinished {
            await process(result)
        }
        _ = await verifyCurrentEntitlements()
    }

    private func verifyCurrentEntitlements() async -> (anyActive: Bool, note: String?) {
        var anyActive = false
        var note: String?
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  transaction.productID == AppStoreBilling.productID else { continue }
            switch await process(result) {
            case .accepted(active: true): anyActive = true
            case .belongsToAnotherAccount(let message), .retryLater(let message): note = message
            default: break
            }
        }
        return (anyActive, note)
    }

    /// Sends one transaction to the server and finishes it on a definitive
    /// answer. Returns nil when it is not SureWord Pro, failed StoreKit's own
    /// verification, or no account is signed in (left for later).
    @discardableResult
    private func process(_ result: VerificationResult<Transaction>) async -> AppStoreBilling.VerifyOutcome? {
        guard case .verified(let transaction) = result,
              transaction.productID == AppStoreBilling.productID,
              let api else { return nil }
        let started = generation
        let outcome = await Self.verify(jws: result.jwsRepresentation, api: api)
        guard started == generation else { return nil }
        if outcome.shouldFinish { await transaction.finish() }
        if case .accepted(active: true) = outcome, state.phase != .verifying, state.phase != .restoring {
            apply(.verified(outcome))
        }
        return outcome
    }

    nonisolated static func verify(jws: String, api: APIClient) async -> AppStoreBilling.VerifyOutcome {
        do {
            let response = try await api.json(
                AppStoreBilling.verifyPath,
                method: "POST",
                body: AppStoreBilling.VerifyRequest(signedTransaction: jws),
                as: AppStoreBilling.VerifyResponse.self
            )
            return .from(response: response, failureStatus: nil, message: nil)
        } catch let error as APIError {
            return .from(response: nil, failureStatus: error.status, message: error.status == nil ? nil : error.message)
        } catch {
            return .from(response: nil, failureStatus: nil, message: nil)
        }
    }

    private func apply(_ event: PurchaseEvent) {
        state = PurchaseState.reduce(state, event)
    }
}
