import XCTest

@testable import SureWord

/// The Membership lines (APPLE-BILL-4, -6) ported from Android's
/// `membershipView.test.ts`, plus the Apple-only wording rules: iOS never
/// names the website, the Mac offers its checkout only to a Free reader, and
/// a Pro wall shows "See SureWord Pro" only where Pro can be bought.
final class MembershipViewTests: XCTestCase {
    private let fmt: (Date) -> String = { date in
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
    private let periodEnd = "2026-11-27T00:00:00.000Z"

    private func subscription(
        provider: String = "stripe",
        status: String = "active",
        periodEnd: String? = nil,
        cancelAtPeriodEnd: Bool? = nil
    ) -> MembershipResponse.Subscription {
        .init(status: status, periodEnd: periodEnd, cancelAtPeriodEnd: cancelAtPeriodEnd, provider: provider)
    }

    private func membership(
        plan: String,
        owner: Bool = false,
        checkout: Bool? = nil,
        appStore: Bool? = nil,
        provider: String? = nil,
        status: String = "active"
    ) throws -> MembershipResponse {
        var object: [String: Any] = ["plan": plan, "owner": owner, "enabled": true]
        if let checkout { object["checkoutAvailable"] = checkout }
        if let appStore { object["appStoreCheckoutAvailable"] = appStore }
        if let provider { object["subscription"] = ["provider": provider, "status": status] }
        return try JSONDecoder().decode(MembershipResponse.self, from: JSONSerialization.data(withJSONObject: object))
    }

    // MARK: - subscriptionStatusLine

    func testSaysNothingWithoutASubscription() {
        XCTAssertNil(MembershipView.subscriptionStatusLine(plan: "free", subscription: nil, formatDate: fmt))
        XCTAssertNil(MembershipView.subscriptionStatusLine(plan: "pro", subscription: nil, formatDate: fmt))
    }

    func testNamesTheRenewalDateForAnActiveProSubscription() {
        XCTAssertEqual(
            MembershipView.subscriptionStatusLine(
                plan: "pro",
                subscription: subscription(periodEnd: periodEnd, cancelAtPeriodEnd: false),
                formatDate: fmt
            ),
            "Current billing period ends 2026-11-27."
        )
    }

    func testSaysWhenPaidAccessEndsAfterACancel() {
        XCTAssertEqual(
            MembershipView.subscriptionStatusLine(
                plan: "pro",
                subscription: subscription(periodEnd: periodEnd, cancelAtPeriodEnd: true),
                formatDate: fmt
            ),
            "Paid access ends 2026-11-27."
        )
    }

    func testExplainsAFailedPaymentBeforeALapse() {
        XCTAssertEqual(
            MembershipView.subscriptionStatusLine(plan: "free", subscription: subscription(status: "past_due", periodEnd: periodEnd), formatDate: fmt),
            "Your last payment did not go through. Update your payment method to restore Pro."
        )
        XCTAssertEqual(
            MembershipView.subscriptionStatusLine(plan: "free", subscription: subscription(status: "unpaid"), formatDate: fmt),
            "Your last payment did not go through. Update your payment method to restore Pro."
        )
    }

    func testSaysWhenALapsedSubscriptionEnded() {
        XCTAssertEqual(
            MembershipView.subscriptionStatusLine(plan: "free", subscription: subscription(status: "canceled", periodEnd: periodEnd), formatDate: fmt),
            "Paid access ended 2026-11-27."
        )
    }

    func testDropsAnUnreadableDateInsteadOfPrintingIt() {
        XCTAssertNil(MembershipView.subscriptionStatusLine(plan: "pro", subscription: subscription(periodEnd: "nope"), formatDate: fmt))
    }

    func testReadsADateWithoutFractionalSeconds() {
        XCTAssertEqual(
            MembershipView.subscriptionStatusLine(plan: "pro", subscription: subscription(periodEnd: "2026-11-27T00:00:00Z"), formatDate: fmt),
            "Current billing period ends 2026-11-27."
        )
    }

    // MARK: - externalManagementLine

    func testPointsAppStoreSubscribersToTheirAppleIDSettings() {
        for platform in [MembershipView.Platform.iOS, .macOS] {
            XCTAssertEqual(
                MembershipView.externalManagementLine(plan: "pro", subscription: subscription(provider: "app_store"), platform: platform),
                "This subscription was bought on an Apple device. Manage it in your Apple ID settings."
            )
        }
    }

    func testTheMacPointsWebSubscribersToTheWebsite() {
        XCTAssertEqual(
            MembershipView.externalManagementLine(plan: "pro", subscription: subscription(provider: "stripe"), platform: .macOS),
            "This subscription was bought on sureword.app. Manage it there under Membership."
        )
    }

    func testIOSNeverNamesTheWebsite() {
        let line = MembershipView.externalManagementLine(plan: "pro", subscription: subscription(provider: "stripe"), platform: .iOS)
        XCTAssertNotNil(line)
        XCTAssertFalse(line?.localizedCaseInsensitiveContains("sureword.app") ?? true)
        XCTAssertFalse(line?.localizedCaseInsensitiveContains("web") ?? true)
        XCTAssertFalse(line?.localizedCaseInsensitiveContains("http") ?? true)
    }

    func testSaysWhereAGooglePlaySubscriptionIsManaged() {
        // Android has its own Play link; an Apple device does not.
        XCTAssertEqual(
            MembershipView.externalManagementLine(plan: "pro", subscription: subscription(provider: "google-play"), platform: .iOS),
            "This subscription was bought on Google Play. Manage it in the Play Store on your Android device."
        )
    }

    func testNeverPointsALapsedSubscriberAtAnotherStore() {
        XCTAssertNil(MembershipView.externalManagementLine(plan: "free", subscription: subscription(status: "canceled"), platform: .macOS))
        XCTAssertEqual(
            MembershipView.externalManagementLine(plan: "free", subscription: subscription(status: "past_due"), platform: .macOS),
            "This subscription was bought on sureword.app. Manage it there under Membership."
        )
        XCTAssertNil(MembershipView.externalManagementLine(plan: "pro", subscription: nil, platform: .macOS), "allowlist Pro")
    }

    // MARK: - Null-usage fallback

    func testFallbackDropsComingSoonWhereProIsSoldHere() {
        XCTAssertEqual(
            MembershipView.freeFallbackLine(plan: "free", owner: false, canUpgradeHere: true),
            "Continue studying free, or upgrade to SureWord Pro."
        )
        XCTAssertEqual(
            MembershipView.freeFallbackLine(plan: "free", owner: false, canUpgradeHere: false),
            "Continue studying free. Pro memberships are coming soon."
        )
    }

    func testFallbackSaysNothingToProOrTheOwner() {
        XCTAssertNil(MembershipView.freeFallbackLine(plan: "pro", owner: false, canUpgradeHere: true))
        XCTAssertNil(MembershipView.freeFallbackLine(plan: "free", owner: true, canUpgradeHere: false))
    }

    // MARK: - MacBilling

    func testTheMacOffersWebCheckoutOnlyToAFreeReader() throws {
        XCTAssertTrue(MacBilling.canOfferWebUpgrade(try membership(plan: "free", checkout: true)))
        XCTAssertFalse(MacBilling.canOfferWebUpgrade(try membership(plan: "free", checkout: false)))
        XCTAssertFalse(MacBilling.canOfferWebUpgrade(try membership(plan: "free")), "older server: no field")
        XCTAssertFalse(MacBilling.canOfferWebUpgrade(try membership(plan: "pro", checkout: true)))
        XCTAssertFalse(MacBilling.canOfferWebUpgrade(try membership(plan: "free", owner: true, checkout: true)))
        XCTAssertFalse(MacBilling.canOfferWebUpgrade(nil))
    }

    func testMacManagementSurvivesFailedPaymentsAndLapses() throws {
        for status in ["active", "past_due", "unpaid", "canceled"] {
            XCTAssertEqual(MacBilling.management(for: try membership(plan: "free", provider: "stripe", status: status)), .web)
            XCTAssertEqual(MacBilling.management(for: try membership(plan: "free", provider: "app_store", status: status)), .appStore)
            XCTAssertEqual(MacBilling.management(for: try membership(plan: "free", provider: "google-play", status: status)), .googlePlay)
        }
        XCTAssertNil(MacBilling.management(for: try membership(plan: "pro", owner: true, provider: "stripe")))
        XCTAssertNil(MacBilling.management(for: try membership(plan: "pro")), "allowlist access has no subscription")
        XCTAssertNil(MacBilling.management(for: try membership(plan: "free", provider: "unknown")))
    }

    func testIOSCanManageItsSubscriptionEvenWhenFree() throws {
        for status in ["active", "past_due", "unpaid", "canceled"] {
            XCTAssertTrue(MembershipView.canManageInAppStore(try membership(plan: "free", provider: "app_store", status: status)))
        }
        XCTAssertFalse(MembershipView.canManageInAppStore(try membership(plan: "pro", owner: true, provider: "app_store")))
        XCTAssertFalse(MembershipView.canManageInAppStore(try membership(plan: "pro", provider: "stripe")))
        XCTAssertFalse(MembershipView.canManageInAppStore(nil))
    }

    // MARK: - ProUpgradeOffer

    func testIOSWallsOfferProOnlyWhenStoreKitCanSellIt() throws {
        XCTAssertTrue(ProUpgradeOffer.canOffer(try membership(plan: "free", appStore: true), platform: .iOS))
        XCTAssertFalse(ProUpgradeOffer.canOffer(try membership(plan: "free", appStore: false), platform: .iOS))
        // Web checkout alone never shows the button on iOS.
        XCTAssertFalse(ProUpgradeOffer.canOffer(try membership(plan: "free", checkout: true), platform: .iOS))
        XCTAssertFalse(ProUpgradeOffer.canOffer(try membership(plan: "pro", appStore: true), platform: .iOS))
        XCTAssertFalse(ProUpgradeOffer.canOffer(try membership(plan: "free", owner: true, appStore: true), platform: .iOS))
        XCTAssertFalse(ProUpgradeOffer.canOffer(nil, platform: .iOS))
    }

    func testMacWallsOfferProOnlyWhenTheWebsiteCanSellIt() throws {
        XCTAssertTrue(ProUpgradeOffer.canOffer(try membership(plan: "free", checkout: true), platform: .macOS))
        XCTAssertFalse(ProUpgradeOffer.canOffer(try membership(plan: "free", appStore: true), platform: .macOS))
        XCTAssertFalse(ProUpgradeOffer.canOffer(try membership(plan: "pro", checkout: true), platform: .macOS))
        XCTAssertFalse(ProUpgradeOffer.canOffer(nil, platform: .macOS))
    }

    func testThisTargetIsIOS() {
        XCTAssertEqual(MembershipView.Platform.current, .iOS)
    }
}
