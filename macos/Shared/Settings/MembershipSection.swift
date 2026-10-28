import SwiftUI

struct MembershipResponse: Decodable, Sendable {
    struct Usage: Decodable, Sendable {
        struct Window: Decodable, Sendable { let end: String }
        let dailyRemaining: Int
        let monthlyRemaining: Int?
        let day: Window
    }
    let plan: String
    let owner: Bool
    let enabled: Bool
    // `access` and `hasPersonalKeys` are no longer read: since 2026-10-25
    // every account runs on included AI (no bring-your-own-key), so there is
    // no payer choice to draw.
    let usage: Usage?
    /// Absent on servers older than StoreKit billing; read as nil/false.
    let subscription: Subscription?
    let appStoreCheckoutAvailable: Bool?
    /// Stripe checkout on the website. Only the Mac acts on it (iOS never
    /// points at the website); absent on older servers, read as false.
    let checkoutAvailable: Bool?

    struct Subscription: Decodable, Sendable {
        let status: String
        let periodEnd: String?
        let cancelAtPeriodEnd: Bool?
        /// "stripe" | "google-play" | "app_store".
        let provider: String
    }
}

/// Shared account balances and subscription state (Android's Membership
/// card, `MembershipSection.tsx`). On iOS it links to `ProMembershipView`,
/// where Pro is bought through StoreKit. The Mac ships outside the App Store,
/// so Pro is bought and a Stripe subscription managed on the website, which
/// it opens in the browser (`MacBilling`).
struct MembershipSection: View {
    let api: APIClient?
    @Environment(\.scenePhase) private var scenePhase
    @State private var membership: MembershipResponse?
    @State private var isPending = false
    @State private var errorMessage: String?
    #if os(macOS)
    @Environment(\.openURL) private var openURL
    #endif

    var body: some View {
        Section("Membership & included AI") {
            if let membership {
                LabeledContent("Membership", value: membership.owner ? "Owner access" : membership.plan == "pro" ? "SureWord Pro" : "SureWord Free")
            }
            #if os(iOS)
            // iOS only: Pro is sold in-app through StoreKit (App Review
            // 3.1.3(b)). The Mac links to the website instead
            // (`webBilling`). Outside the membership
            // check on purpose: a slow or failed /api/billing/status must
            // never hide the way to buy, and ProMembershipView loads (and
            // retries) the status itself.
            NavigationLink("SureWord Pro") { ProMembershipView() }
            #endif
            if let membership {
                if membership.owner {
                    Text("All paid benefits and configured models are available without a subscription.")
                        .appFont(.caption).foregroundStyle(.secondary)
                } else if let usage = membership.usage {
                    LabeledContent("Messages left today", value: "\(usage.dailyRemaining)")
                    if let monthly = usage.monthlyRemaining {
                        LabeledContent("Left this billing period", value: "\(monthly)")
                    }
                    Text("Daily reset: \(localReset(usage.day.end))")
                        .appFont(.caption).foregroundStyle(.secondary)
                } else if let line = MembershipView.freeFallbackLine(
                    plan: membership.plan,
                    owner: membership.owner,
                    canUpgradeHere: canUpgradeHere(membership)
                ) {
                    note(line)
                }
                if !membership.owner {
                    if let line = MembershipView.subscriptionStatusLine(
                        plan: membership.plan,
                        subscription: membership.subscription
                    ) {
                        note(line)
                    }
                    if let line = MembershipView.externalManagementLine(
                        plan: membership.plan,
                        subscription: membership.subscription
                    ) {
                        note(line)
                    }
                    #if os(macOS)
                    webBilling(membership)
                    #endif
                }
            } else if isPending {
                ProgressView("Loading membership")
            }
            Text("Your Bible, notes, highlights and saved study remain available when your AI allowance runs out.")
                .appFont(.caption).foregroundStyle(.secondary)
            if let errorMessage {
                Text(errorMessage).appFont(.caption).foregroundStyle(.secondary)
                Button("Reload membership") { Task { await load() } }.disabled(isPending)
            }
        }
        .task { await load() }
        // A purchase or billing change may have happened in the browser or
        // the system subscription manager while this page stayed mounted.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
    }

    private func note(_ text: String) -> some View {
        Text(text).appFont(.caption).foregroundStyle(.secondary)
    }

    /// Whether this screen itself can sell Pro, for the fallback line.
    private func canUpgradeHere(_ membership: MembershipResponse) -> Bool {
        #if os(iOS)
        AppStoreBilling.offer(for: membership) == .purchasable
        #else
        MacBilling.canOfferWebUpgrade(membership)
        #endif
    }

    #if os(macOS)
    /// Subscribe and Manage, on the Mac. Provider management stays available
    /// after a failed payment or lapse, as on the web Membership page.
    @ViewBuilder
    private func webBilling(_ membership: MembershipResponse) -> some View {
        if MacBilling.canOfferWebUpgrade(membership) {
            Button("Subscribe on sureword.app") { openURL(MacBilling.membershipURL) }
            note("Opens the SureWord website in your browser, where you sign in with this same account.")
        }
        switch MacBilling.management(for: membership) {
        case .web:
            Button("Manage subscription") { openURL(MacBilling.membershipURL) }
            note("Opens Membership on the SureWord website. You may need to sign in there.")
        case .appStore:
            Button("Manage subscription") { openURL(AccountDeletion.manageSubscriptionsURL) }
        case .googlePlay:
            Button("Manage in Google Play") { openURL(MacBilling.googlePlayManagementURL) }
        case nil:
            EmptyView()
        }
    }
    #endif

    private func localReset(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)?.formatted(date: .abbreviated, time: .shortened) ?? value
    }

    @MainActor private func load() async {
        guard let api, !isPending else { return }
        isPending = true
        defer { isPending = false }
        do {
            let value = try await api.json("/api/billing/status", as: MembershipResponse.self)
            guard !Task.isCancelled else { return }
            membership = value
            errorMessage = nil
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = "Membership details are temporarily unavailable."
        }
    }
}
