import Foundation
import Testing
@testable import SureWord

@Suite("Configuration")
struct ConfigTests {
    /// The publishable key encodes its Clerk Frontend API host. Decoding it is the
    /// documented way to tell which instance a key points at, and a mismatch here
    /// takes sign-in down outright — so pin it.
    @Test("Publishable key points at clerk.sureword.app")
    func publishableKeyHost() throws {
        let encoded = Config.clerkPublishableKey.replacingOccurrences(of: "pk_live_", with: "")
        let padded = encoded.padding(
            toLength: ((encoded.count + 3) / 4) * 4,
            withPad: "=",
            startingAt: 0
        )
        let data = try #require(Data(base64Encoded: padded))
        let host = try #require(String(data: data, encoding: .utf8))
        #expect(host == "clerk.sureword.app$")
    }

    @Test("API base URL matches the shared backend")
    func apiURL() {
        #expect(Config.apiURL.absoluteString == "https://sureword.app")
    }
}
