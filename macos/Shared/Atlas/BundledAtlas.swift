import CryptoKit
import Foundation
import JavaScriptCore

/// The Android/server atlas core, compiled at build time and shipped with its
/// reviewed JSON. Every JavaScriptCore object stays on this actor; only JSON
/// decoded into Sendable Swift responses crosses back to a native view model.
/// There is deliberately no network fallback for a missing or corrupt bundle.
actor BundledAtlas {
    static let shared = BundledAtlas(
        resourceURL: Bundle.main.url(forResource: "atlas", withExtension: "js", subdirectory: "AtlasData")
    )

    enum Operation: String, Codable, Sendable {
        case timeline, entities, search, chapter, entity, event, connection
    }

    struct Parameters: Codable, Sendable {
        var era: String? = nil
        var book: Int? = nil
        var chapter: Int? = nil
        var personID: String? = nil
        var kind: String? = nil
        var cursor: String? = nil
        var limit: Int? = nil
        var query: String? = nil
        var id: String? = nil
        var from: String? = nil
        var to: String? = nil
    }

    struct Manifest: Decodable, Sendable {
        let schemaVersion: Int
        let inputSha256: String
        let scriptSha256: String
        let counts: [String: Int]
    }

    private struct Reply<Value: Decodable>: Decodable {
        let status: Int
        let value: Value?
        let error: String?
    }

    private let resourceURL: URL?
    private var engine: JSContext?
    private var loadedManifest: Manifest?

    /// URL injection is for bundle-integrity tests, not remote/user code.
    /// Context construction and execution happen lazily inside actor isolation.
    init(resourceURL: URL?) {
        self.resourceURL = resourceURL
    }

    func manifest() throws -> Manifest {
        try load()
        guard let loadedManifest else { throw Self.unavailable }
        return loadedManifest
    }

    func query<Value: Decodable & Sendable>(
        _ operation: Operation,
        parameters: Parameters = Parameters(),
        as type: Value.Type
    ) throws -> Value {
        try Task.checkCancellation()
        try load()
        guard let engine,
              let function = engine.objectForKeyedSubscript("surewordAtlasQuery"),
              !function.isUndefined, !function.isNull
        else { throw Self.unavailable }
        let input: String
        do {
            input = String(decoding: try JSONEncoder().encode(parameters), as: UTF8.self)
        } catch {
            throw Self.unavailable
        }
        engine.exception = nil
        let result = function.call(withArguments: [operation.rawValue, input])
        guard engine.exception == nil, let json = result?.toString() else {
            // Do not expose JavaScript exceptions, source paths or query content.
            engine.exception = nil
            throw Self.unavailable
        }
        try Task.checkCancellation()
        let reply: Reply<Value>
        do {
            reply = try JSONDecoder().decode(Reply<Value>.self, from: Data(json.utf8))
        } catch {
            throw Self.unavailable
        }
        guard reply.status == 200, let value = reply.value else {
            // The generated bridge returns constant messages, never input text.
            throw APIError(message: reply.error ?? "The offline Bible atlas could not be read.", status: reply.status)
        }
        return value
    }

    private func load() throws {
        if engine != nil { return }
        guard let resourceURL, resourceURL.isFileURL,
              let bytes = try? Data(contentsOf: resourceURL),
              let source = String(data: bytes, encoding: .utf8),
              let manifestBytes = try? Data(contentsOf: resourceURL.deletingLastPathComponent().appending(path: "manifest.json")),
              let manifest = try? JSONDecoder().decode(Manifest.self, from: manifestBytes),
              manifest.schemaVersion == 1,
              SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == manifest.scriptSha256,
              let context = JSContext()
        else { throw Self.unavailable }
        context.evaluateScript(source)
        guard context.exception == nil,
              let function = context.objectForKeyedSubscript("surewordAtlasQuery"),
              function.isObject
        else { throw Self.unavailable }
        loadedManifest = manifest
        engine = context
    }

    private static var unavailable: APIError {
        APIError(message: "The offline Bible atlas is unavailable. Reinstall or update SureWord.", code: "atlas_bundle_unavailable")
    }
}

