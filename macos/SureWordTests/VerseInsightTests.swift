import Foundation
import Testing
@testable import SureWord

/// `/api/verse-insight` answers with a plain-text stream, and
/// `URLSession.AsyncBytes` hands it over one byte at a time — so the assembler,
/// not the decoder, is where a split multi-byte character would surface as a
/// flickering replacement glyph. These pin that.
@MainActor
@Suite("Verse insight stream assembly")
struct VerseInsightStreamTests {

    private typealias Assembler = PlainTextStreamAssembler

    /// Feed a string in byte at a time, exactly as the network path does.
    private func assemble(_ source: String) -> (text: String, updates: Int) {
        var assembler = Assembler()
        var updates = 0
        for byte in Array(source.utf8) where assembler.append(byte) {
            updates += 1
        }
        return (assembler.finish(), updates)
    }

    @Test("Reassembles plain ASCII exactly")
    func reassemblesASCII() {
        let source = String(
            repeating: "The verse sets the fear of the LORD against every other fear. ",
            count: 6
        )
        let result = assemble(source)
        #expect(result.text == source)
    }

    @Test("Reassembles multi-byte characters split across reads")
    func reassemblesMultiByte() {
        // Curly quotes and an em dash are what the model actually emits, and
        // each is multi-byte — a naive per-byte decode mangles all three.
        let source = "Paul’s point — “whom shall I fear?” — is not rhetorical. ✝ Ἰησοῦς"
        let result = assemble(source)
        #expect(result.text == source)
        #expect(!result.text.contains("\u{FFFD}"))
    }

    @Test("Never exposes a partial character mid-stream")
    func neverExposesPartialCharacter() {
        let source = "señor — “fear” ✝ Ἰησοῦς κύριος, repeated for length and more length here."
        var assembler = Assembler()
        for byte in Array(source.utf8) {
            _ = assembler.append(byte)
            // Whatever is visible at any point must be a clean prefix of the
            // final text — never a replacement glyph.
            #expect(!assembler.text.contains("\u{FFFD}"))
            #expect(source.hasPrefix(assembler.text))
        }
        #expect(assembler.finish() == source)
    }

    @Test("Flushes in batches rather than once per byte")
    func flushesInBatches() {
        let source = String(repeating: "a b c d e f g h ", count: 40)
        let result = assemble(source)
        #expect(result.text == source)
        // One update per byte is the failure this batching exists to prevent.
        #expect(result.updates < source.utf8.count / Assembler.minimumFlush + 2)
        #expect(result.updates > 0)
    }

    @Test("Emits a stalled non-ASCII run once it reaches the ceiling")
    func emitsWithoutASCII() {
        // No byte below 0x80 anywhere, so only the pending ceiling can flush it.
        let source = String(repeating: "κύριος", count: 40)
        let result = assemble(source)
        #expect(result.text == source)
        #expect(result.updates > 0)
    }

    @Test("An empty stream assembles to nothing")
    func handlesEmptyStream() {
        let result = assemble("")
        #expect(result.text.isEmpty)
        #expect(result.updates == 0)
    }

    /// Short answers are below the flush threshold, so they only appear when
    /// the stream ends — `finish()` is what makes them visible at all.
    @Test("A short answer survives in the final flush")
    func flushesShortTail() {
        let result = assemble("Trust Him.")
        #expect(result.text == "Trust Him.")
    }
}
