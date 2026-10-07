import Foundation
import Testing
@testable import SureWord

/// Settings -> About links. Pins the two destinations and that neither is the
/// terms page, which states the Pro price.
@Suite("About links")
struct AboutLinksTests {

    @Test("Privacy Policy and Support point at sureword.app, in that order")
    func destinations() {
        #expect(AboutLinks.all.map(\.title) == ["Privacy Policy", "Support"])
        #expect(AboutLinks.privacyPolicy.absoluteString == "https://sureword.app/privacy")
        #expect(AboutLinks.support.absoluteString == "https://sureword.app/support")
    }

    @Test("Never links the terms page")
    func noTerms() {
        #expect(AboutLinks.all.allSatisfy { !$0.url.path().contains("terms") })
    }
}
