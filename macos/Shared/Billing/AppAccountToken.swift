import CryptoKit
import Foundation

/// The StoreKit `appAccountToken` for a SureWord account: UUIDv5 over the
/// Clerk user id with a fixed namespace.
///
/// Mirrors `appAccountToken` in `src/lib/billing/app-store-rules.ts`; the
/// server binds a purchase to an account only when the transaction carries
/// this exact token. Deterministic, so device and server agree with no round
/// trip; opaque, so Apple never sees the Clerk id. The namespace must never
/// change - every existing purchase is bound under it. Both sides assert the
/// same fixed vector (`tests/app-store-billing.test.mjs`,
/// `StoreKitBillingTests`).
enum AppAccountToken {
    static let namespace = UUID(uuidString: "2F58CFF8-D92F-43E2-93D6-D21633BFFBE5")!

    static func forUser(_ userID: String) -> UUID {
        var input = withUnsafeBytes(of: namespace.uuid) { Array($0) }
        input.append(contentsOf: Array(userID.utf8))
        var bytes = Array(Insecure.SHA1.hash(data: input).prefix(16))
        bytes[6] = (bytes[6] & 0x0F) | 0x50
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        return UUID(uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
        ))
    }
}
