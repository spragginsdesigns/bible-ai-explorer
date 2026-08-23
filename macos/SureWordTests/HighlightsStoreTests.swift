import AppKit
import Foundation
import SwiftUI
import Testing
@testable import SureWord

/// Hex parsing, cache-key format, and the optimistic half of the store's
/// mutations. `cacheURL: nil` keeps each store in memory, and the client
/// points at a dead host so the network half never answers — these cover
/// only what is synchronous and deterministic.
@Suite("Verse highlights")
@MainActor
struct HighlightsStoreTests {

    private func makeStore() -> HighlightsStore {
        HighlightsStore(
            api: APIClient(
                baseURL: URL(string: "https://example.invalid")!,
                token: { _ in nil },
                onAuthFailure: {}
            ),
            cacheURL: nil
        )
    }

    @Test("The cache key is translation:book:chapter:verse")
    func keyFormat() {
        #expect(
            HighlightsStore.key(translation: .kjv, book: 43, chapter: 3, verse: 16)
                == "KJV:43:3:16"
        )
        #expect(
            HighlightsStore.key(translation: .nkjv, book: 1, chapter: 1, verse: 1)
                == "NKJV:1:1:1"
        )
    }

    @Test("A #RRGGBB string parses to the right sRGB components")
    func hexParsing() throws {
        let color = try #require(Color(hex: "#F5D76E"))
        let resolved = try #require(NSColor(color).usingColorSpace(.sRGB))
        #expect(abs(Double(resolved.redComponent) - 0xF5 / 255.0) < 0.001)
        #expect(abs(Double(resolved.greenComponent) - 0xD7 / 255.0) < 0.001)
        #expect(abs(Double(resolved.blueComponent) - 0x6E / 255.0) < 0.001)
    }

    @Test("The leading # is optional and lowercase parses too")
    func hexParsingLenient() {
        #expect(Color(hex: "27AE60") != nil)
        #expect(Color(hex: "#1abc9c") != nil)
    }

    @Test("Malformed hex strings fail rather than guess")
    func hexParsingRejects() {
        #expect(Color(hex: "#F5D76") == nil)
        #expect(Color(hex: "#F5D76EFF") == nil)
        #expect(Color(hex: "yellow") == nil)
        #expect(Color(hex: "") == nil)
    }

    @Test("The preset palette keeps the shared cross-platform order")
    func presetOrder() {
        #expect(HighlightColors.presets.map(\.hex) == [
            "#F5D76E", "#F5A623", "#E84C3D", "#E87EA1",
            "#9B59B6", "#4A90D9", "#1ABC9C", "#27AE60"
        ])
    }

    @Test("setColor applies the hex optimistically")
    func setColorOptimistic() {
        let store = makeStore()
        store.setColor(translation: .kjv, book: 43, chapter: 3, verse: 16, hex: "#F5D76E")
        #expect(store.hex(translation: .kjv, book: 43, chapter: 3, verse: 16) == "#F5D76E")
        #expect(store.color(translation: .kjv, book: 43, chapter: 3, verse: 16) != nil)
    }

    @Test("remove clears the verse optimistically")
    func removeOptimistic() {
        let store = makeStore()
        store.setColor(translation: .kjv, book: 43, chapter: 3, verse: 16, hex: "#F5D76E")
        store.remove(translation: .kjv, book: 43, chapter: 3, verse: 16)
        #expect(store.hex(translation: .kjv, book: 43, chapter: 3, verse: 16) == nil)
    }
}
