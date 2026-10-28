import Foundation
import UIKit
import XCTest

@testable import SureWord

/// The pure rules behind the 2026-10-28 chat parity pass: the composer's model
/// chip (Android `modelPickerRules.test.ts` → "composerChip"), the error card's
/// Pro offer (`usePlayUpgrade`), receipt → Settings pages (`receiptRoutes.ts`),
/// the attachment preview refresh, the shared image upload rule, and the tool
/// activity labels against the server's table.
@MainActor
final class ChatParityRulesTests: XCTestCase {
    private typealias Rules = ModelPickerSheet

    func testAllowanceUsesItsOwnTitleAndLocalResetTime() {
        let raw = "You've used your included AI allowance. More messages are available at 2026-10-28T00:00:00.000Z."
        let result = ChatErrors.classify(APIError.server(status: 429, message: raw, code: "rate_limited", plan: "free"))
        XCTAssertEqual(result.title, "You've used today's messages")
        XCTAssertFalse(result.message.contains("2026-10-28T00:00:00.000Z"))
        XCTAssertTrue(result.upgrade)
        XCTAssertEqual(ChatErrors.build(.rateLimited, serverMessage: "Slow down.").title, "Too many requests")
        XCTAssertEqual(ChatErrors.build(.rateLimited, serverMessage: "No free messages remain.", override: "Custom").message, "Custom")
    }

    func testResetLocalizationHandlesOffsetsMultipleDatesAndInvalidDates() {
        let locale = Locale(identifier: "en_US")
        let zone = TimeZone(secondsFromGMT: -7 * 60 * 60)!
        let localized = ChatErrors.localizeTimestamps("A 2026-10-29T00:00:00.000Z; B 2026-10-28T17:00-07:00.", locale: locale, timeZone: zone)
        XCTAssertFalse(localized.contains("2026-"))
        XCTAssertEqual(localized.components(separatedBy: "Wed").count, 3)
        XCTAssertEqual(localized.components(separatedBy: "5:00").count, 3)
        let invalid = "Reset 2026-13-28T00:00:00Z."
        XCTAssertEqual(ChatErrors.localizeTimestamps(invalid, locale: locale, timeZone: zone), invalid)
        XCTAssertEqual(ChatErrors.build(.internal, serverMessage: "2026-10-28T00:00:00Z").message, "2026-10-28T00:00:00Z")
    }

    private static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // SureWord-iOSTests
        .deletingLastPathComponent() // macos
        .deletingLastPathComponent() // repo

    // MARK: describe("composerChip")

    private func model(_ id: String, label: String? = nil, provider: String = "openai", premium: Bool = false) -> AIModel {
        AIModel(
            id: id,
            label: label ?? id,
            provider: provider,
            supportsAttachments: false,
            efforts: ["low", "medium", "high"],
            available: true,
            premium: premium
        )
    }

    private func housePayload(premium: Bool) -> AIModelsResponse {
        var house = AIModelsResponse.HouseModel(modelId: "gpt-6-luna", label: "SureWord AI", effort: "low", note: nil)
        house.premium = premium
        return AIModelsResponse(
            access: "house",
            providers: [],
            models: [model("gpt-6-luna")],
            defaults: .init(modelId: "gpt-6-luna", effort: "low"),
            house: house
        )
    }

    private func ownerPayload() -> AIModelsResponse {
        AIModelsResponse(
            access: "keys",
            providers: [AIProviderSummary(id: "sureword", label: "SureWord", available: true)],
            models: [
                model("sureword/pro", label: "SureWord AI", provider: "sureword", premium: true),
                model("sureword/free", label: "SureWord AI", provider: "sureword"),
            ],
            defaults: .init(modelId: "sureword/pro", effort: nil),
            house: nil
        )
    }

    private func keysPayload() -> AIModelsResponse {
        AIModelsResponse(
            access: "keys",
            providers: [AIProviderSummary(id: "openai", label: "OpenAI", available: true)],
            models: [model("gpt-5.6"), model("gpt-5.6-mini")],
            defaults: .init(modelId: "gpt-5.6", effort: nil),
            house: nil
        )
    }

    private func chip(_ data: AIModelsResponse?, stored: String? = nil, effort: String? = nil) -> Rules.ComposerChip? {
        Rules.composerChip(data: data, stored: stored, effort: effort, speed: nil, verbosity: nil, mode: nil)
    }

    func testChipIsHiddenUntilTheListLoads() {
        XCTAssertNil(chip(nil))
    }

    func testChipNamesTheHouseModelAndMarksPro() {
        XCTAssertEqual(chip(housePayload(premium: false)), .init(label: "SureWord AI", premium: false))
        XCTAssertEqual(chip(housePayload(premium: true)), .init(label: "SureWord AI", premium: true))
        XCTAssertEqual(
            Rules.composerChipAccessibilityLabel(.init(label: "SureWord AI", premium: true)),
            "Choose AI model, currently SureWord AI, Pro"
        )
        XCTAssertEqual(
            Rules.composerChipAccessibilityLabel(.init(label: "SureWord AI", premium: false)),
            "Choose AI model, currently SureWord AI"
        )
    }

    func testChipFollowsTheOwnersPlanPick() {
        XCTAssertEqual(chip(ownerPayload()), .init(label: "SureWord AI", premium: true))
        XCTAssertEqual(chip(ownerPayload(), stored: "sureword/free"), .init(label: "SureWord AI", premium: false))
    }

    func testChipSummarisesAKeyHoldersModelWithoutAMark() {
        XCTAssertEqual(chip(keysPayload(), stored: "gpt-5.6", effort: "high"), .init(label: "gpt-5.6 \u{00B7} High", premium: false))
    }

    // MARK: "See SureWord Pro" (Android usePlayUpgrade)

    private func membership(plan: String = "free", owner: Bool = false, provider: String? = nil, checkout: Bool?) throws -> MembershipResponse {
        var object: [String: Any] = ["plan": plan, "owner": owner, "enabled": true]
        if let provider { object["subscription"] = ["status": "active", "provider": provider] }
        if let checkout { object["appStoreCheckoutAvailable"] = checkout }
        return try JSONDecoder().decode(MembershipResponse.self, from: JSONSerialization.data(withJSONObject: object))
    }

    func testProIsOfferedOnlyWhenTheAppStoreCanSellIt() throws {
        XCTAssertTrue(ChatProOffer.canOffer(upgrade: true, membership: try membership(checkout: true)))
        // Billing not configured server-side, or an older server.
        XCTAssertFalse(ChatProOffer.canOffer(upgrade: true, membership: try membership(checkout: false)))
        XCTAssertFalse(ChatProOffer.canOffer(upgrade: true, membership: try membership(checkout: nil)))
        // Already Pro elsewhere, or the owner: never sell what the account has.
        XCTAssertFalse(ChatProOffer.canOffer(upgrade: true, membership: try membership(plan: "pro", provider: "stripe", checkout: true)))
        XCTAssertFalse(ChatProOffer.canOffer(upgrade: true, membership: try membership(owner: true, checkout: true)))
        // A failed status read, or an error that is not a used-up allowance.
        XCTAssertFalse(ChatProOffer.canOffer(upgrade: true, membership: nil))
        XCTAssertFalse(ChatProOffer.canOffer(upgrade: false, membership: try membership(checkout: true)))
    }

    // MARK: describe("receiptNavigation") settings pages

    func testSettingsReceiptsOpenTheirPage() {
        XCTAssertEqual(ReceiptLine.settingsPage(for: .memory), .memory)
        XCTAssertEqual(ReceiptLine.settingsPage(for: .church), .church)
        // Preferences live on several pages, so Settings opens on its hub.
        XCTAssertNil(ReceiptLine.settingsPage(for: .preferences))
        XCTAssertNil(ReceiptLine.settingsPage(for: nil))
    }

    // MARK: Attachment preview refresh

    func testOpenPrefersTheFreshestPreviewURL() {
        XCTAssertEqual(
            AttachmentPreviewRefresh.openTarget(fresh: "https://a/fresh", refreshed: "https://a/old", original: "https://a/orig"),
            URL(string: "https://a/fresh")
        )
        XCTAssertEqual(
            AttachmentPreviewRefresh.openTarget(fresh: nil, refreshed: "https://a/old", original: "https://a/orig"),
            URL(string: "https://a/old")
        )
        XCTAssertEqual(
            AttachmentPreviewRefresh.openTarget(fresh: nil, refreshed: nil, original: "https://a/orig"),
            URL(string: "https://a/orig")
        )
    }

    // MARK: Image upload rule (Android imageDownscale.test.ts)

    private func png(width: Int, height: Int) throws -> Data {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        return try XCTUnwrap(image.pngData())
    }

    func testSharedRuleMatchesTheIOSEncoderRule() {
        XCTAssertEqual(ImageDownscale.maxEdge, ImageUploadSizing.maxEdge)
        XCTAssertEqual(ImageUploadSizing.maxEdge, 2048)
        XCTAssertEqual(ImageUploadSizing.jpegQuality, 0.85)
        XCTAssertNil(ImageUploadSizing.targetSize(width: 2048, height: 2048))
        XCTAssertNil(ImageUploadSizing.targetSize(width: 0, height: 100))
        XCTAssertTrue(ImageUploadSizing.targetSize(width: 4000, height: 3000)! == (2048, 1536))
        XCTAssertTrue(ImageUploadSizing.targetSize(width: 3000, height: 4000)! == (1536, 2048))
    }

    func testOversizedImagesBecomeDownscaledJPEGs() throws {
        let prepared = ImageUploadSizing.prepared(filename: "photo.png", data: try png(width: 3000, height: 1500))
        XCTAssertEqual(prepared.filename, "photo.jpg")
        XCTAssertEqual(AttachmentLimits.sniffImageMediaType(prepared.data), "image/jpeg")
        let decoded = try XCTUnwrap(UIImage(data: prepared.data))
        XCTAssertEqual(ImageDownscale.pixelSize(of: decoded).width, 2048)
        XCTAssertEqual(ImageDownscale.pixelSize(of: decoded).height, 1024)
    }

    func testSmallImagesAndDocumentsPassThroughUntouched() throws {
        let small = try png(width: 800, height: 600)
        let kept = ImageUploadSizing.prepared(filename: "small.png", data: small)
        XCTAssertEqual(kept.filename, "small.png")
        XCTAssertEqual(kept.data, small)
        let text = Data("John 3:16".utf8)
        XCTAssertNil(ImageUploadSizing.downscaledJPEG(text))
        XCTAssertEqual(ImageUploadSizing.prepared(filename: "notes.txt", data: text).data, text)
    }

    // MARK: Tool activity labels (src/lib/tool-activity-labels.ts)

    func testToolLabelsMatchTheServersTableExactly() throws {
        let source = try String(
            contentsOf: Self.repoRoot.appending(path: "src/lib/tool-activity-labels.ts"),
            encoding: .utf8
        )
        let pattern = try NSRegularExpression(pattern: "^\\t(\\w+): \"([^\"]*)\",$", options: [.anchorsMatchLines])
        let ns = source as NSString
        var server: [String: String] = [:]
        for match in pattern.matches(in: source, range: NSRange(location: 0, length: ns.length)) {
            server["tool-\(ns.substring(with: match.range(at: 1)))"] = ns.substring(with: match.range(at: 2))
        }
        XCTAssertGreaterThan(server.count, 40)
        XCTAssertEqual(ChatViewMessage.toolActivityLabels, server)
    }

    // MARK: Pasting an image into the composer

    func testPastedImagesAreNamedLikeTheClipboardRow() throws {
        let photo = PickedPhoto(attachment: LocalAttachment(filename: "photo-1.png", mediaType: "image/png", data: try png(width: 10, height: 10)))
        let named = ClipboardAttachments.named([photo, photo], now: Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertEqual(named.map(\.mediaType), ["image/png", "image/png"])
        XCTAssertEqual(named.count, 2)
        XCTAssertTrue(named.allSatisfy { $0.filename.hasPrefix("clipboard-") && $0.filename.hasSuffix(".png") })
        XCTAssertNotEqual(named[0].filename, named[1].filename)
    }
}
