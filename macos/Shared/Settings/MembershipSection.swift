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
    let access: String
    let hasPersonalKeys: Bool
    let usage: Usage?
    /// Absent on servers older than StoreKit billing; read as nil/false.
    let subscription: Subscription?
    let appStoreCheckoutAvailable: Bool?

    struct Subscription: Decodable, Sendable {
        let status: String
        let periodEnd: String?
        let cancelAtPeriodEnd: Bool?
        /// "stripe" | "google-play" | "app_store".
        let provider: String
    }
}

/// Shared account balances and payer choice. On iOS it links to
/// `ProMembershipView`, where Pro is bought through StoreKit; macOS has no
/// purchase UI.
struct MembershipSection: View {
    let api: APIClient?
    @State private var membership: MembershipResponse?
    @State private var isPending = false
    @State private var errorMessage: String?

    var body: some View {
        Section("Membership & included AI") {
            if let membership {
                LabeledContent("Membership", value: membership.owner ? "Owner access" : membership.plan == "pro" ? "SureWord Pro" : "SureWord Free")
                #if os(iOS)
                // iOS only: Pro is sold in-app through StoreKit (App Review
                // 3.1.3(b)). The Mac shows no purchase UI.
                NavigationLink("SureWord Pro") { ProMembershipView() }
                #endif
                if membership.owner {
                    Text("All paid benefits and configured models are available without a subscription.")
                        .font(.caption).foregroundStyle(.secondary)
                } else if let usage = membership.usage {
                    LabeledContent("Messages left today", value: "\(usage.dailyRemaining)")
                    if let monthly = usage.monthlyRemaining {
                        LabeledContent("Left this billing period", value: "\(monthly)")
                    }
                    Text("Daily reset: \(localReset(usage.day.end))")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if membership.enabled && !membership.owner && membership.hasPersonalKeys {
                    Picker("AI payment", selection: Binding(
                        get: { membership.access },
                        set: { access in Task { await choose(access) } }
                    )) {
                        Text("Included AI").tag("house")
                        Text("My API key").tag("keys")
                    }
                    .disabled(isPending)
                    Text("Included AI uses your SureWord allowance. Personal keys are billed by your provider.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else if isPending {
                ProgressView("Loading membership")
            }
            Text("Your Bible, notes, highlights and saved study remain available when your AI allowance runs out.")
                .font(.caption).foregroundStyle(.secondary)
            if let errorMessage {
                Text(errorMessage).font(.caption).foregroundStyle(.secondary)
                Button("Reload membership") { Task { await load() } }.disabled(isPending)
            }
        }
        .task { await load() }
    }

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

    @MainActor private func choose(_ access: String) async {
        guard let api, !isPending else { return }
        struct Choice: Encodable { let access: String }
        isPending = true
        defer { isPending = false }
        do {
            membership = try await api.json("/api/billing/status", method: "PATCH", body: Choice(access: access), as: MembershipResponse.self)
            errorMessage = nil
        } catch {
            errorMessage = "Could not update your AI payment choice. Please try again."
        }
    }
}
