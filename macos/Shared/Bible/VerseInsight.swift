import Foundation

/// Tap-a-verse: a short KJV-grounded explanation of one verse, streamed as
/// plain text from `POST /api/verse-insight`.
///
/// Port of `mobile/src/features/bible/useVerseInsight.ts` and its web twin
/// `src/components/bible/useVerseInsight.ts` — same state machine
/// (`idle → loading → streaming → done | error`), same session cache keyed
/// `translation:reference`, same run-id guard. If one side changes, change all
/// three.
///
/// The Mac client deliberately sends no `modelId`: it has no model picker yet
/// (Android 1.12.0's BYOK/provider UI is still unported), and the route falls
/// back to the account default when the field is absent. Adding a picker here
/// later is the only change needed.
@MainActor
@Observable
final class VerseInsightModel {
    enum Status: Equatable {
        case idle, loading, streaming, done, error
    }

    struct Target: Equatable, Sendable {
        let reference: String
        let text: String
        let translation: TranslationID
    }

    private(set) var status: Status = .idle
    private(set) var text = ""
    private(set) var error: String?

    /// Session cache so re-opening a verse renders instantly and never re-bills
    /// the model. Partial output is never cached. MainActor-isolated with the
    /// rest of the type, which is what makes a mutable static safe here.
    private static var cache: [String: String] = [:]

    /// Smallest gap between two view updates while streaming. Fast enough to
    /// read as live typing, slow enough that the reader can keep up.
    private static let publishInterval: Duration = .milliseconds(200)

    private let api: APIClient
    private var task: Task<Void, Never>?
    /// Guards every state write: only the most recent `start()`/`reset()` may
    /// touch state, so a slow stream for verse A can never bleed into a row
    /// that has already moved to verse B.
    private var runID = 0

    init(api: APIClient) {
        self.api = api
    }

    /// The last target handed to `start()`, so the error state can retry
    /// without the view having to remember what it asked for.
    private(set) var target: Target?

    func reset() {
        runID += 1
        task?.cancel()
        task = nil
        target = nil
        status = .idle
        text = ""
        error = nil
    }

    func retry() {
        guard let target else { return }
        start(target)
    }

    func start(_ target: Target) {
        runID += 1
        let id = runID
        task?.cancel()
        task = nil
        self.target = target

        if let cached = Self.cache[Self.key(target)] {
            text = cached
            error = nil
            status = .done
            return
        }

        text = ""
        error = nil
        status = .loading

        task = Task {
            do {
                let bytes = try await api.stream("/api/verse-insight", body: Request(target))
                var full = ""
                var lastPublished: ContinuousClock.Instant?

                // Assembly happens off the main actor (see `snapshots`); only
                // the publish hops back here, and only on a cadence. Chunks
                // arrive far faster than a reader can follow, and every one is
                // a view update — this keeps the panel legible and the main
                // thread free.
                for try await snapshot in Self.snapshots(from: bytes) {
                    guard runID == id else { return }
                    guard !snapshot.isEmpty else { continue }
                    full = snapshot

                    let now = ContinuousClock.now
                    if let lastPublished, now - lastPublished < Self.publishInterval { continue }
                    lastPublished = now
                    text = snapshot
                    status = .streaming
                }

                guard runID == id else { return }
                guard !full.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    throw APIError(message: "The model returned nothing.")
                }
                Self.cache[Self.key(target)] = full
                text = full
                status = .done
            } catch {
                // A superseded or cancelled run is not a failure the user
                // should see — the row it belonged to is already gone.
                guard runID == id, !Task.isCancelled else { return }
                self.error = (error as? APIError)?.message
                    ?? "The explanation could not be generated. Try again."
                status = .error
            }
        }
    }

    /// Assemble the plain-text byte stream **off** the main actor, yielding the
    /// text so far each time it grows.
    ///
    /// The off-main part is not incidental. `URLSession.AsyncBytes` yields one
    /// byte at a time, and a `Task` started from a `@MainActor` method inherits
    /// that isolation — so the whole loop would run on the main thread, hopping
    /// through the actor thousands of times while the reader tries to re-lay
    /// out a full chapter of text on every update. `UIMessageStream.lines` is
    /// structured the same way, for the same reason.
    private nonisolated static func snapshots(
        from bytes: some AsyncSequence<UInt8, any Error> & Sendable
    ) -> AsyncThrowingStream<String, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var assembler = PlainTextStreamAssembler()
                do {
                    for try await byte in bytes where assembler.append(byte) {
                        continuation.yield(assembler.text)
                    }
                    continuation.yield(assembler.finish())
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func key(_ target: Target) -> String {
        "\(target.translation.rawValue):\(target.reference)"
    }

    /// Test seam: the cache is process-wide by design, which would otherwise
    /// leak one test's fixture into the next.
    static func clearCache() {
        cache.removeAll()
    }

    private struct Request: Encodable {
        let reference: String
        let text: String
        let translation: String

        init(_ target: Target) {
            reference = target.reference
            text = target.text
            translation = target.translation.rawValue
        }
    }
}

/// Assembles `/api/verse-insight`'s plain-text byte stream into a string that
/// is safe to show at every step.
///
/// Deliberately a plain, non-isolated value type: it runs inside the off-main
/// task that drains the byte stream, so it must not inherit `VerseInsightModel`'s
/// `@MainActor` isolation.
///
/// Two things it exists to get right. **Boundaries**: a multi-byte character can
/// be split across reads, and rendering half of one shows a replacement glyph
/// that then flickers away — so bytes are only promoted once they decode.
/// **Rate**: the TS clients get one state update per network chunk, but
/// `URLSession.AsyncBytes` yields one *byte* at a time, and one view update per
/// byte would spend the whole answer re-laying-out a chapter of text. Flushing
/// in small batches restores chunk-like cadence without holding tokens back
/// long enough to look stalled.
struct PlainTextStreamAssembler {
    /// Smallest batch worth a view update.
    static let minimumFlush = 16
    /// Ceiling for text with no ASCII in it, which would otherwise never hit
    /// the boundary check and would stall until the stream ended.
    static let maximumPending = 64

    private(set) var text = ""
    private var pending: [UInt8] = []

    /// Returns true when `text` grew and the view should be updated.
    mutating func append(_ byte: UInt8) -> Bool {
        pending.append(byte)
        // Any byte below 0x80 is a complete character, so it also ends whatever
        // came before it — no continuation byte can follow.
        let atBoundary = byte < 0x80 && pending.count >= Self.minimumFlush
        guard atBoundary || pending.count >= Self.maximumPending,
              let chunk = String(data: Data(pending), encoding: .utf8)
        else { return false }
        pending.removeAll(keepingCapacity: true)
        text += chunk
        return true
    }

    /// Flush the tail. Anything still undecodable here is genuinely truncated
    /// output, so it is decoded leniently rather than dropped.
    mutating func finish() -> String {
        if !pending.isEmpty {
            text += String(decoding: pending, as: UTF8.self)
            pending.removeAll()
        }
        return text
    }
}
