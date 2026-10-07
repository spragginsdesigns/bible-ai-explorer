import StoreKit
import SwiftUI

/// Settings → Membership → SureWord Pro, iOS only: SureWord Pro sold through
/// StoreKit 2 (App Review 3.1.3(b): what a web or Play purchase unlocks must
/// also be for sale in-app). Also opened from the locked Listen panel.
///
/// Never a web link or a mention of buying elsewhere. The price always comes
/// from the `Product` (localized by the App Store), never from this file.
/// Pro from Stripe, Google Play, the allowlist or owner access shows "Pro is
/// active on your account" and no purchase button.
struct ProMembershipView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.purchase) private var purchase

    @State private var membership: MembershipResponse?
    /// Evidence/test seam: a known membership instead of `/api/billing/status`.
    private let fixedMembership: MembershipResponse?

    init(membership: MembershipResponse? = nil) {
        fixedMembership = membership
        _membership = State(initialValue: membership)
    }
    @State private var loadFailed = false
    @State private var isManaging = false

    private var store: ProPurchaseStore { ProPurchaseStore.shared }

    private var offer: AppStoreBilling.Offer? {
        if store.state.phase == .subscribed { return .activeHere }
        return membership.map(AppStoreBilling.offer(for:))
    }

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("SureWord Pro")
                        .font(.title2.weight(.semibold))
                    Text("More room to study, and Scripture read aloud.")
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                Label("Listen: today's devotional as a spoken reading", systemImage: "waveform")
                Label("50 AI messages a day, up to 600 each billing month (Free: 20 a day)", systemImage: "bubble.left.and.text.bubble.right")
            }

            switch offer {
            case .activeElsewhere:
                Section {
                    Label("Pro is active on your account", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(.primary)
                }
            case .activeHere:
                activeHereSection
            case .purchasable:
                purchaseSection
            case .unavailable:
                Section {
                    Text("SureWord Pro isn't available to buy in the app yet.")
                        .foregroundStyle(.secondary)
                }
            case nil:
                Section {
                    if loadFailed {
                        Text("Membership details are temporarily unavailable.")
                            .foregroundStyle(.secondary)
                        Button("Try again") { Task { await loadMembership() } }
                    } else {
                        ProgressView()
                    }
                }
            }

            if offer == .purchasable || offer == .activeHere {
                Section {
                    Text(disclosure)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Link("Privacy Policy", destination: AppStoreBilling.privacyURL)
                    Link("Terms of Use (EULA)", destination: AppStoreBilling.eulaURL)
                }
            }
        }
        .navigationTitle("SureWord Pro")
        .navigationBarTitleDisplayMode(.inline)
        .manageSubscriptionsSheet(isPresented: $isManaging)
        .task {
            await loadMembership()
            await store.loadProduct()
        }
        .onChange(of: store.state.phase) { _, phase in
            if phase == .subscribed { Task { await loadMembership() } }
        }
        .onChange(of: isManaging) { _, open in
            // Back from Apple's sheet: a cancel or resubscribe may have changed things.
            if !open { Task { await loadMembership() } }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private var purchaseSection: some View {
        Section {
            if let product = store.product {
                LabeledContent(product.displayName.isEmpty ? "SureWord Pro" : product.displayName) {
                    Text("\(product.displayPrice) / month")
                }
                Button {
                    Task { await subscribe(to: product) }
                } label: {
                    HStack {
                        Text("Subscribe")
                        if store.state.phase == .purchasing || store.state.phase == .verifying {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                // No account token means no binding: the server would refuse it.
                .disabled(store.state.isBusy || store.state.phase == .pending || store.appAccountToken == nil)
            } else if store.state.phase == .unavailable {
                Text("SureWord Pro couldn't be loaded from the App Store. Check your connection and try again.")
                    .foregroundStyle(.secondary)
                Button("Try again") { Task { await store.loadProduct() } }
            } else {
                ProgressView()
            }
            restoreButton
            if let message = store.state.message {
                Text(message).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var activeHereSection: some View {
        Section {
            Label("SureWord Pro is active", systemImage: "checkmark.seal.fill")
            if let subscription = membership?.subscription, subscription.provider == "app_store",
               let end = subscription.periodEnd.flatMap(Self.date) {
                LabeledContent(subscription.cancelAtPeriodEnd == true ? "Ends" : "Renews",
                               value: end.formatted(date: .abbreviated, time: .omitted))
            }
            Button("Manage subscription") { isManaging = true }
            restoreButton
            if let message = store.state.message {
                Text(message).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private var restoreButton: some View {
        Button {
            Task { await store.restore() }
        } label: {
            HStack {
                Text("Restore Purchases")
                if store.state.phase == .restoring {
                    Spacer()
                    ProgressView()
                }
            }
        }
        .disabled(store.state.isBusy)
    }

    private var disclosure: String {
        let price = store.product?.displayPrice ?? store.state.displayPrice
        let priceText = price.map { "\($0) per month" } ?? "the monthly price shown above"
        return "SureWord Pro is an auto-renewing subscription: 1 month for \(priceText). "
            + "Payment is charged to your Apple Account when you confirm the purchase. "
            + "It renews automatically each month unless canceled at least 24 hours before the end of the current period, "
            + "and your account is charged for the renewal within 24 hours before the period ends. "
            + "Cancel anytime in Settings → your name → Subscriptions, or with Manage subscription."
    }

    // MARK: - Actions

    private func subscribe(to product: Product) async {
        store.purchaseStarted()
        do {
            let result = try await purchase(product, options: store.purchaseOptions)
            await store.handle(result)
        } catch {
            store.purchaseFailed(error)
        }
    }

    @MainActor private func loadMembership() async {
        if fixedMembership != nil { return }
        do {
            membership = try await app.api.json("/api/billing/status", as: MembershipResponse.self)
            loadFailed = false
        } catch {
            if membership == nil { loadFailed = true }
        }
    }

    private static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
