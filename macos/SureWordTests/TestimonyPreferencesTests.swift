import Foundation
import Testing
@testable import SureWord

/// "My testimony" on the account-preferences pipe: the wire shapes and how a
/// document lands in `SettingsStore`. Mirrors the server contract in
/// `src/lib/preferences-contract.ts` (`testimony`, "" when unset, capped at
/// `MAX_TESTIMONY_LENGTH`) and `tests/testimony.test.mjs`.
///
/// Serialized because `SettingsStore` is backed by `UserDefaults.standard`;
/// each test puts back whatever this machine had under the key.
@MainActor
@Suite("Testimony preferences", .serialized)
struct TestimonyPreferencesTests {
    private static let key = "settings.testimony"

    // MARK: - Wire shapes

    @Test("A document with a testimony decodes it")
    func decodesTestimony() throws {
        let payload = Data(
            """
            { "aboutMe": "Baptist, studying Romans", "testimony": "I was lost, and He found me." }
            """.utf8
        )
        let document = try JSONDecoder().decode(AccountPreferences.self, from: payload)
        #expect(document.testimony == "I was lost, and He found me.")
        #expect(document.aboutMe == "Baptist, studying Romans")
    }

    @Test("An unset testimony arrives as an empty string, not as absent")
    func decodesEmptyTestimony() throws {
        let payload = Data(#"{ "testimony": "" }"#.utf8)
        let document = try JSONDecoder().decode(AccountPreferences.self, from: payload)
        #expect(document.testimony == "")
    }

    @Test("A document from a server that predates the column still decodes")
    func decodesWithoutTestimony() throws {
        let payload = Data(
            """
            { "plan": "free", "translation": "KJV", "aboutMe": "" }
            """.utf8
        )
        let document = try JSONDecoder().decode(AccountPreferences.self, from: payload)
        #expect(document.testimony == nil)
        #expect(document.translation == "KJV")
    }

    @Test("The patch carries the testimony and nothing else")
    func encodesPatch() throws {
        let json = try Self.object(encoding: PreferencesPatch(testimony: "Saved at nineteen."))
        #expect(json["testimony"] as? String == "Saved at nineteen.")
        #expect(Set(json.keys) == ["testimony"])
    }

    @Test("An emptied box saves as an empty string, which clears the column")
    func encodesClear() throws {
        let patch = PreferencesPatch(testimony: "")
        #expect(!patch.isEmpty)
        let json = try Self.object(encoding: patch)
        #expect(json["testimony"] as? String == "")
    }

    @Test("A patch that never touched the testimony leaves the key out")
    func omitsUntouchedTestimony() throws {
        let json = try Self.object(encoding: PreferencesPatch(aboutMe: "Hello"))
        #expect(!json.keys.contains("testimony"))
        #expect(PreferencesPatch().isEmpty)
    }

    // MARK: - Applying a document

    @Test("A document without the field leaves the local testimony alone")
    func absentKeepsLocal() {
        let prior = UserDefaults.standard.string(forKey: Self.key)
        defer { Self.restore(prior) }
        let settings = SettingsStore()
        settings.testimony = "Written on this Mac"
        let sync = PreferencesSyncModel(transport: StubTransport(), settings: settings)

        sync.apply(AccountPreferences(translation: "KJV"), fromServer: true)

        #expect(settings.testimony == "Written on this Mac")
    }

    @Test("A document with the field replaces the local testimony, empty included")
    func presentReplacesLocal() {
        let prior = UserDefaults.standard.string(forKey: Self.key)
        defer { Self.restore(prior) }
        let settings = SettingsStore()
        settings.testimony = "Old text"
        let sync = PreferencesSyncModel(transport: StubTransport(), settings: settings)

        sync.apply(AccountPreferences(testimony: "New text"), fromServer: true)
        #expect(settings.testimony == "New text")

        sync.apply(AccountPreferences(testimony: ""), fromServer: true)
        #expect(settings.testimony == "")
    }

    @Test("Saving sends only the testimony and lands the server's echo")
    func saveRoundTrip() async {
        let prior = UserDefaults.standard.string(forKey: Self.key)
        defer { Self.restore(prior) }
        let settings = SettingsStore()
        settings.testimony = ""
        let transport = StubTransport()
        let sync = PreferencesSyncModel(transport: transport, settings: settings)

        let outcome = await sync.saveTestimony("  He made me new.  ")

        #expect(outcome == .saved)
        let patches = await transport.patches
        #expect(patches == [PreferencesPatch(testimony: "  He made me new.  ")])
        // The stub trims the way the route does, so this is the echo, not the
        // raw draft.
        #expect(settings.testimony == "He made me new.")
    }

    @Test("A failed save reports inline and keeps the local testimony")
    func saveFailure() async {
        let prior = UserDefaults.standard.string(forKey: Self.key)
        defer { Self.restore(prior) }
        let settings = SettingsStore()
        settings.testimony = "Kept"
        let transport = StubTransport(failsSaves: true)
        let sync = PreferencesSyncModel(transport: transport, settings: settings)

        let outcome = await sync.saveTestimony("Lost?")

        #expect(outcome == .failed("Preferences are unavailable."))
        #expect(settings.testimony == "Kept")
        #expect(sync.errorAlert == nil)
    }

    // MARK: - Helpers

    private static func object(encoding value: some Encodable) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        // `JSONSerialization` rather than a round-trip through `Decodable`:
        // only it can tell an absent key from a null one.
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private static func restore(_ prior: String?) {
        if let prior {
            UserDefaults.standard.set(prior, forKey: key)
        } else {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }
}

/// Behaves like the route for the one field under test: a PATCH trims the
/// testimony, stores it, and answers with the whole document.
private actor StubTransport: PreferencesTransport {
    private(set) var patches: [PreferencesPatch] = []
    private var document = AccountPreferences(testimony: "")
    private let failsSaves: Bool

    init(failsSaves: Bool = false) {
        self.failsSaves = failsSaves
    }

    func loadPreferences() async throws -> AccountPreferences {
        document
    }

    func savePreferences(_ patch: PreferencesPatch) async throws -> AccountPreferences {
        patches.append(patch)
        if failsSaves { throw APIError(message: "Preferences are unavailable.") }
        if let value = patch.testimony {
            document.testimony = value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return document
    }
}
