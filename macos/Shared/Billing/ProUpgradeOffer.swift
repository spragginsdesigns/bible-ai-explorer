import Foundation

/// Whether a Pro wall (the locked Listen panel, a used-up daily allowance) may
/// show "See SureWord Pro" - the Apple port of Android's `usePlayUpgrade`.
///
/// The button opens Settings on Membership, so it is offered only where that
/// screen itself has Pro to sell: on iOS when StoreKit checkout is on
/// (`AppStoreBilling.offer(for:) == .purchasable`), on the Mac when the
/// website's checkout is (`MacBilling.canOfferWebUpgrade`). A wall reads
/// `/api/billing/status` on demand, only while it is showing, so a Pro reader
/// or a screen with no wall never pays for the request.
enum ProUpgradeOffer {
    /// The decision for a status already in hand. Nil (not loaded, or the
    /// read failed) answers false: no button beats a button that leads to a
    /// screen with nothing to buy.
    static func canOffer(_ membership: MembershipResponse?, platform: MembershipView.Platform = .current) -> Bool {
        guard let membership else { return false }
        switch platform {
        case .iOS: return AppStoreBilling.offer(for: membership) == .purchasable
        case .macOS: return MacBilling.canOfferWebUpgrade(membership)
        }
    }

    /// Reads the status and decides. Any failure answers false.
    @MainActor
    static func load(api: APIClient) async -> Bool {
        let membership = try? await api.json("/api/billing/status", as: MembershipResponse.self)
        return canOffer(membership)
    }
}
