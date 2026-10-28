import Foundation

/// Pure copy for the Membership section's subscription lines, kept apart from
/// the view so it is unit-tested (`MembershipViewTests`). The Apple port of
/// `mobile/src/features/settings/membershipView.ts`, which mirrors the web
/// /membership page: the same period and payment state for every store.
///
/// Not a SwiftUI view despite the name; the name is Android's file, so the
/// two are found together.
enum MembershipView {
    /// Which client is drawing the line. The wording differs only where a
    /// store's rules say it must: iOS never names the website a subscription
    /// can be bought on (App Review 3.1.1), so it never names it as the place
    /// to manage one either.
    enum Platform: Equatable, Sendable {
        case iOS, macOS

        static var current: Platform {
            #if os(iOS)
            .iOS
            #else
            .macOS
            #endif
        }
    }

    /// When the paid period ends, has ended, or why it stopped. Nil when
    /// there is nothing to say. `plan` is `/api/billing/status`'s "free" or
    /// "pro"; anything but "pro" reads as Free, as Android's union does.
    static func subscriptionStatusLine(
        plan: String,
        subscription: MembershipResponse.Subscription?,
        formatDate: (Date) -> String = { $0.formatted(date: .abbreviated, time: .omitted) }
    ) -> String? {
        guard let subscription else { return nil }
        let date = subscription.periodEnd.flatMap(parseDate).map(formatDate)
        if plan != "pro" {
            if subscription.status == "past_due" || subscription.status == "unpaid" {
                return "Your last payment did not go through. Update your payment method to restore Pro."
            }
            return date.map { "Paid access ended \($0)." }
        }
        guard let date else { return nil }
        return "\(subscription.cancelAtPeriodEnd == true ? "Paid access ends" : "Current billing period ends") \(date)."
    }

    /// Where a subscription bought in another store is managed. Plain text,
    /// not a link: this device cannot manage another store's subscription.
    /// Only for a subscription that is still live (Pro, or a failed payment to
    /// fix), so a lapsed one is never pointed at another store to buy again.
    ///
    /// Android leaves Google Play to its own link; an Apple device has none,
    /// so it says where that one is managed too.
    static func externalManagementLine(
        plan: String,
        subscription: MembershipResponse.Subscription?,
        platform: Platform = .current
    ) -> String? {
        let live = plan == "pro" || subscription?.status == "past_due" || subscription?.status == "unpaid"
        guard live, let subscription else { return nil }
        switch subscription.provider {
        case "app_store":
            return "This subscription was bought on an Apple device. Manage it in your Apple ID settings."
        case "stripe":
            return platform == .iOS
                ? "This subscription was bought outside the App Store. Manage it where you subscribed."
                : "This subscription was bought on sureword.app. Manage it there under Membership."
        case "google-play":
            return "This subscription was bought on Google Play. Manage it in the Play Store on your Android device."
        default:
            return nil
        }
    }

    /// Apple's management sheet also resolves failed payments and lapsed
    /// subscriptions. Free access must not hide that route.
    static func canManageInAppStore(_ membership: MembershipResponse?) -> Bool {
        membership?.owner == false && membership?.subscription?.provider == "app_store"
    }

    /// The line a Free account sees when the server reports no usage
    /// (metering off). Android's sentence says Pro is "coming soon", which is
    /// untrue wherever Pro can be bought from this screen, so that case says
    /// so instead. Nil for Pro and the owner: "continue studying free" would
    /// be wrong for them.
    static func freeFallbackLine(plan: String, owner: Bool, canUpgradeHere: Bool) -> String? {
        guard !owner, plan != "pro" else { return nil }
        return canUpgradeHere
            ? "Continue studying free, or upgrade to SureWord Pro."
            : "Continue studying free. Pro memberships are coming soon."
    }

    /// `periodEnd` arrives as an ISO 8601 instant, with or without fractional
    /// seconds. An unreadable one is dropped rather than printed.
    static func parseDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

/// The Mac's half of SureWord Pro. The Mac app ships outside the App Store
/// (a DMG), so Pro is bought on the website with Stripe, never in the app.
/// The rule is pure and unconditional so the iOS test target pins it; the
/// web addresses and every control that uses them are macOS-only.
enum MacBilling {
    /// Whether a Pro wall (the locked Listen panel, a used-up allowance) or
    /// the Membership section may offer the website's checkout: a Free
    /// reader, not the owner, with Stripe checkout on. Nil status (not
    /// loaded, or failed) answers false: no button beats one that leads to
    /// a page with nothing to buy.
    static func canOfferWebUpgrade(plan: String, owner: Bool, checkoutAvailable: Bool?) -> Bool {
        checkoutAvailable == true && !owner && plan != "pro"
    }

    static func canOfferWebUpgrade(_ membership: MembershipResponse?) -> Bool {
        guard let membership else { return false }
        return canOfferWebUpgrade(
            plan: membership.plan,
            owner: membership.owner,
            checkoutAvailable: membership.checkoutAvailable
        )
    }

    /// Existing subscriptions remain manageable after access lapses or a
    /// payment fails, just as on the web Membership page.
    enum Management: Equatable, Sendable { case web, appStore, googlePlay }

    static func management(for membership: MembershipResponse) -> Management? {
        guard !membership.owner, let subscription = membership.subscription else { return nil }
        switch subscription.provider {
        case "stripe": return .web
        case "app_store": return .appStore
        case "google-play": return .googlePlay
        default: return nil
        }
    }

    #if os(macOS)
    static let googlePlayManagementURL = URL(string: "https://play.google.com/store/account/subscriptions?sku=sureword_pro&package=com.spragginsdesigns.sureword")!
    /// The web Membership page: Stripe checkout for Free, the customer
    /// portal for a Stripe subscriber. The reader signs in there.
    static let membershipURL = Config.apiURL.appending(path: "membership")
    #endif
}
