import XCTest

@testable import SureWord

/// BYOK provider plumbing (Lane 5): `GET /api/providers` payload decoding and
/// the masked-key status line — mirrored from
/// `mobile/src/features/settings/aiApi.ts`.
final class AIProviderTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testDecodesProvidersResponse() throws {
        let response = try decode(AIProvidersResponse.self, """
            {
              "serverCredentials": true,
              "providers": [
                {
                  "id": "openai",
                  "label": "OpenAI",
                  "keyUrl": "https://platform.openai.com/api-keys",
                  "connected": true,
                  "last4": "sk42",
                  "validatedAt": "2026-08-01T12:00:00Z"
                },
                {
                  "id": "anthropic",
                  "label": "Anthropic",
                  "keyUrl": "https://console.anthropic.com/settings/keys",
                  "connected": false,
                  "last4": null,
                  "validatedAt": null
                }
              ]
            }
            """)

        XCTAssertTrue(response.serverCredentials)
        XCTAssertEqual(response.providers.count, 2)

        let openai = response.providers[0]
        XCTAssertEqual(openai.id, "openai")
        XCTAssertEqual(openai.keyURL?.host, "platform.openai.com")
        XCTAssertEqual(openai.statusLine, "Key ending in sk42")
        XCTAssertEqual(response.providers[1].statusLine, "Not connected")
    }

    func testStatusLineNeverShowsMoreThanLast4() {
        // Connected but last4 missing (a server bug, or an old row): degrade
        // to "Not connected" rather than risk rendering a key fragment.
        let provider = AIProviderStatus(
            id: "moonshot", label: "Moonshot", keyURL: nil,
            connected: true, last4: nil, validatedAt: nil
        )
        XCTAssertEqual(provider.statusLine, "Not connected")
    }
}
