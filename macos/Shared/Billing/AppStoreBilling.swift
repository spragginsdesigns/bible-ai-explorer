import Foundation

/// The pure half of SureWord Pro through StoreKit 2: the product id, the
/// verify request, what a server answer means for `Transaction.finish()`, and
/// the purchase-state reducer the Membership screen renders. `ProPurchaseStore`
/// is the StoreKit half. See `docs/FEATURES.md` → "App Store subscription".
enum AppStoreBilling {
    /// The one auto-renewable subscription (group "SureWord Pro", 1 month).
    static let productID = "com.spragginsdesigns.sureword.pro.monthly"
    static let verifyPath = "/api/billing/app-store/verify"
    static let privacyURL = URL(string: "https://sureword.app/privacy")!
    /// Apple's standard Licensed Application End User License Agreement.
    static let eulaURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!

    /// What the Membership screen offers for this account.
    enum Offer: Equatable, Sendable {
        /// Pro through Stripe, Google Play, the allowlist or owner access:
        /// no purchase button (never sell what the account already has).
        case activeElsewhere
        /// Pro through this App Store subscription: manage and restore.
        case activeHere
        /// Free, and the server can verify StoreKit purchases.
        case purchasable
        /// Free, but App Store billing is not configured server-side; a
        /// purchase could not be confirmed, so none is offered.
        case unavailable
    }

    static func offer(for membership: MembershipResponse) -> Offer {
        if membership.owner { return .activeElsewhere }
        if membership.plan == "pro" {
            return membership.subscription?.provider == "app_store" ? .activeHere : .activeElsewhere
        }
        return membership.appStoreCheckoutAvailable == true ? .purchasable : .unavailable
    }

    /// Body of `POST /api/billing/app-store/verify`.
    struct VerifyRequest: Encodable, Equatable, Sendable {
        let signedTransaction: String
    }

    struct VerifyResponse: Decodable, Sendable {
        let verified: Bool
        let active: Bool
        let status: String?
        let expiresAt: String?
    }

    /// What the server's answer means for the transaction.
    enum VerifyOutcome: Equatable, Sendable {
        /// Recorded (active or not). Finish the transaction.
        case accepted(active: Bool)
        /// Genuine but bound to another SureWord account (403). Finish it: no
        /// retry will ever deliver it to this account.
        case belongsToAnotherAccount(String)
        /// Anything else (offline, 5xx, unverifiable). Leave it unfinished so
        /// StoreKit redelivers it and the next launch retries.
        case retryLater(String)

        var shouldFinish: Bool {
            switch self {
            case .accepted, .belongsToAnotherAccount: true
            case .retryLater: false
            }
        }

        /// Maps a verify-route result. `status` is the HTTP status of a
        /// failure; nil with a response means 2xx.
        static func from(response: VerifyResponse?, failureStatus: Int?, message: String?) -> VerifyOutcome {
            if let response, response.verified { return .accepted(active: response.active) }
            if failureStatus == 403 {
                return .belongsToAnotherAccount(message ?? "This App Store subscription belongs to another SureWord account.")
            }
            return .retryLater(message ?? "Your purchase couldn't be confirmed yet. SureWord will try again shortly.")
        }
    }
}

/// What the Membership screen shows while buying or restoring Pro.
struct PurchaseState: Equatable, Sendable {
    enum Phase: Equatable, Sendable {
        case idle
        case loadingProduct
        /// The product loaded; Subscribe is offered.
        case ready
        /// StoreKit returned no product (not configured for this storefront).
        case unavailable
        case purchasing
        /// Apple charged; SureWord is confirming with the server.
        case verifying
        /// Ask to Buy or a deferred payment: nothing to do until Apple decides.
        case pending
        case restoring
        /// The server confirmed an active App Store subscription.
        case subscribed
    }

    var phase: Phase = .idle
    var displayPrice: String?
    /// A one-line note under the buttons (errors and outcomes).
    var message: String?

    var isBusy: Bool {
        switch phase {
        case .loadingProduct, .purchasing, .verifying, .restoring: true
        default: false
        }
    }

    var canPurchase: Bool { phase == .ready || (phase == .idle && displayPrice != nil) }
}

enum PurchaseEvent: Equatable, Sendable {
    case loadStarted
    case productLoaded(displayPrice: String)
    case productUnavailable
    case purchaseStarted
    case userCancelled
    case pending
    case verifying
    case verified(AppStoreBilling.VerifyOutcome)
    case restoreStarted
    /// `anyActive`: at least one current entitlement was accepted as active.
    /// `note`: why nothing was restored, when the server said so.
    case restoreFinished(anyActive: Bool, note: String?)
    case failed(String)
}

extension PurchaseState {
    /// The single place purchase UI state changes. Pure, so it is tested
    /// without StoreKit (`StoreKitBillingTests`).
    static func reduce(_ state: PurchaseState, _ event: PurchaseEvent) -> PurchaseState {
        var next = state
        switch event {
        case .loadStarted:
            if state.phase == .subscribed { return state }
            next.phase = .loadingProduct
            next.message = nil
        case .productLoaded(let price):
            next.displayPrice = price
            if state.phase == .loadingProduct || state.phase == .idle || state.phase == .unavailable {
                next.phase = .ready
            }
        case .productUnavailable:
            next.displayPrice = nil
            if state.phase != .subscribed { next.phase = .unavailable }
        case .purchaseStarted:
            next.phase = .purchasing
            next.message = nil
        case .userCancelled:
            next.phase = state.displayPrice == nil ? .unavailable : .ready
            next.message = nil
        case .pending:
            next.phase = .pending
            next.message = "Your purchase is waiting for approval. Pro will turn on once it's approved."
        case .verifying:
            next.phase = .verifying
            next.message = nil
        case .verified(let outcome):
            switch outcome {
            case .accepted(active: true):
                next.phase = .subscribed
                next.message = "Welcome to SureWord Pro."
            case .accepted(active: false):
                next.phase = state.displayPrice == nil ? .unavailable : .ready
                next.message = "That subscription is no longer active."
            case .belongsToAnotherAccount(let message), .retryLater(let message):
                next.phase = state.displayPrice == nil ? .unavailable : .ready
                next.message = message
            }
        case .restoreStarted:
            next.phase = .restoring
            next.message = nil
        case .restoreFinished(let anyActive, let note):
            if anyActive {
                next.phase = .subscribed
                next.message = "Your SureWord Pro subscription is restored."
            } else {
                next.phase = state.displayPrice == nil ? .unavailable : .ready
                next.message = note ?? "No active SureWord Pro subscription was found for this Apple Account."
            }
        case .failed(let message):
            next.phase = state.displayPrice == nil ? .unavailable : .ready
            next.message = message
        }
        return next
    }
}
