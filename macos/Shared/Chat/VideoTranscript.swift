import Foundation

/// "/verify <YouTube link>": pull the video's captions on this device and send
/// them as a text attachment, so the answer can weigh what was said against
/// Scripture. Mirrors `mobile/src/features/chat/videoTranscript.ts`.
///
/// Why on the device: YouTube answers every datacenter IP (Vercel, the VPS)
/// with "Sign in to confirm you're not a bot", measured 2026-10-07, while a
/// home or phone connection gets the full caption track in about a second.
/// The client fetches; the server only reads the text it is sent.
enum VideoTranscript {
    /// About five hours of speech (~75k tokens). The server would take 1 MB,
    /// but the transcript rides in every step and follow-up of the
    /// conversation, and the smaller selectable models cannot hold that much.
    static let maxBytes = 300 * 1024
    static let noCaptions =
        "This video has no captions, so SureWord can't read what's said in it. Paste the part you want checked instead."
    /// One paragraph per this much video, each stamped with where it starts.
    static let paragraphMs = 30_000

    struct Link: Equatable, Sendable {
        let url: String
        let videoID: String
    }

    struct CaptionTrack: Decodable, Equatable, Sendable {
        let baseUrl: String
        let languageCode: String
        /// "asr" for YouTube's automatic captions; absent for uploaded ones.
        var kind: String?
        var isTranslatable: Bool?
    }

    struct Transcript: Equatable, Sendable {
        var videoID: String
        var title: String
        var channel: String
        var lengthSeconds: Int
        var automatic: Bool
        var translated: Bool
        var languageCode: String
        var paragraphs: [String]
    }

    /// Why a video could not be read, worded for the person who shared it.
    struct Failure: Error, Equatable {
        let message: String
    }

    // MARK: Links

    /// The 11-character video id from any YouTube link shape, or nil.
    static func videoID(from input: String) -> String? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let withScheme = trimmed.range(of: #"^[a-zA-Z]+://"#, options: .regularExpression) == nil
            ? "https://\(trimmed)" : trimmed
        guard let components = URLComponents(string: withScheme), let rawHost = components.host?.lowercased() else {
            return nil
        }
        let host = rawHost.replacingOccurrences(of: #"^(www|m|music)\."#, with: "", options: .regularExpression)
        let segments = components.path.split(separator: "/").map(String.init)
        var candidate: String?
        if host == "youtu.be" {
            candidate = segments.first
        } else if host == "youtube.com" || host == "youtube-nocookie.com" {
            if segments.first == "watch" {
                candidate = components.queryItems?.first { $0.name == "v" }?.value
            } else if let first = segments.first, ["shorts", "live", "embed", "v", "e"].contains(first), segments.count > 1 {
                candidate = segments[1]
            }
        }
        guard let candidate, candidate.range(of: #"^[A-Za-z0-9_-]{11}$"#, options: .regularExpression) != nil else {
            return nil
        }
        return candidate
    }

    /// The first YouTube link in a block of text (a share often wraps it in
    /// words). The host must start a word, so "notyoutube.com" is not YouTube,
    /// and the sentence's own punctuation after a link is not part of the id.
    static func findLink(in text: String) -> Link? {
        let pattern = #"(^|[^\w.-])((?:https?://)?(?:[\w-]+\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)/[^\s<>"')\]]+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        for match in regex.matches(in: text, range: range) {
            guard let swiftRange = Range(match.range(at: 2), in: text) else { continue }
            let url = String(text[swiftRange])
                .replacingOccurrences(of: #"[.,!?;:]+$"#, with: "", options: .regularExpression)
            if let id = videoID(from: url) { return Link(url: url, videoID: id) }
        }
        return nil
    }

    /// A "/verify" message that carries a YouTube link. Anything else, including
    /// /verify with only a pasted claim, goes to the model unchanged.
    static func verifyRequest(_ message: String) -> Link? {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: #"^/verify(\s|$)"#, options: [.regularExpression, .caseInsensitive]) != nil else {
            return nil
        }
        return findLink(in: trimmed)
    }

    // MARK: Formatting

    /// Uploaded English beats automatic English, either beats another
    /// language, and another language is asked for in English when it can be.
    static func chooseTrack(_ tracks: [CaptionTrack]) -> (track: CaptionTrack, translated: Bool)? {
        let english: (CaptionTrack) -> Bool = { $0.languageCode.lowercased().hasPrefix("en") }
        if let manual = tracks.first(where: { english($0) && $0.kind != "asr" }) { return (manual, false) }
        if let auto = tracks.first(where: english) { return (auto, false) }
        guard let other = tracks.first(where: { $0.isTranslatable == true }) ?? tracks.first else { return nil }
        return (other, other.isTranslatable == true)
    }

    /// "1:02:03" for an hour or more, "2:03" under it.
    static func timestamp(ms: Int) -> String {
        let total = max(0, ms / 1000)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
            : String(format: "%d:%02d", minutes, seconds)
    }

    struct Json3: Decodable {
        struct Event: Decodable {
            struct Segment: Decodable { var utf8: String? }
            var tStartMs: Int?
            var segs: [Segment]?
        }
        var events: [Event]?
    }

    private static func collapse(_ text: String) -> String {
        text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// Caption events folded into ~30-second paragraphs, each led by its start time.
    static func paragraphs(from captions: Json3) -> [String] {
        var result: [String] = []
        var start: Int?
        var words: [String] = []
        func flush() {
            let text = collapse(words.joined(separator: " "))
            if let start, !text.isEmpty { result.append("[\(timestamp(ms: start))] \(text)") }
            start = nil
            words = []
        }
        for event in captions.events ?? [] {
            let text = collapse((event.segs ?? []).map { $0.utf8 ?? "" }.joined())
            guard !text.isEmpty else { continue }
            let at = event.tStartMs ?? 0
            if let current = start, at - current >= paragraphMs { flush() }
            if start == nil { start = at }
            words.append(text)
        }
        flush()
        return result
    }

    /// The attachment's text: a header the model reads first, then the
    /// paragraphs, cut at a paragraph past the cap and saying where.
    static func fileText(_ transcript: Transcript) -> String {
        let source = transcript.automatic
            ? "YouTube automatic captions (machine-made: names and Bible words are often misheard)"
            : "Captions uploaded by the channel"
        let translatedNote = transcript.translated ? ", translated to English from \"\(transcript.languageCode)\"" : ""
        let header = [
            "YOUTUBE VIDEO TRANSCRIPT",
            "Title: \(transcript.title)",
            "Channel: \(transcript.channel)",
            "Link: https://www.youtube.com/watch?v=\(transcript.videoID)",
            "Length: \(timestamp(ms: transcript.lengthSeconds * 1000))",
            "Source: \(source)\(translatedNote)",
            "",
            "",
        ].joined(separator: "\n")
        var body = ""
        var bytes = header.utf8.count
        var kept = 0
        for paragraph in transcript.paragraphs {
            let size = "\(paragraph)\n\n".utf8.count
            if bytes + size > maxBytes - 200 { break }
            body += "\(paragraph)\n\n"
            bytes += size
            kept += 1
        }
        if kept < transcript.paragraphs.count {
            let last = kept > 0 ? transcript.paragraphs[kept - 1] : ""
            let stamp = last.range(of: #"^\[[^\]]+\]"#, options: .regularExpression)
                .map { String(last[$0].dropFirst().dropLast()) } ?? "0:00"
            body += "[Transcript cut off after \(stamp) to fit. Only the part above was read.]\n"
        }
        while body.hasSuffix("\n") { body.removeLast() }
        return header + body + "\n"
    }

    /// A filename the attachment rules accept: letters, digits and dashes, then .txt.
    static func filename(for title: String) -> String {
        let folded = title.folding(options: [.diacriticInsensitive], locale: .init(identifier: "en_US_POSIX"))
        var slug = folded.replacingOccurrences(of: #"[^A-Za-z0-9]+"#, with: "-", options: .regularExpression)
        slug = slug.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        slug = String(slug.prefix(60))
        return "YouTube-transcript-\(slug.isEmpty ? "video" : slug).txt"
    }

    /// The composer's last step before the answer's own progress takes over.
    static func sendingStatus(lengthSeconds: Int) -> String {
        let minutes = Int((Double(lengthSeconds) / 60).rounded())
        if minutes >= 90 {
            let hours = String(format: "%.1f", Double(lengthSeconds) / 3600)
            return "Sending SureWord the transcript (\(hours) hours of video, so the answer takes a minute or two)..."
        }
        if minutes >= 2 { return "Sending SureWord the transcript (\(minutes) minutes of video)..." }
        return "Sending SureWord the transcript..."
    }

    // MARK: Fetching

    private struct PlayerClient {
        let context: [String: JSONValue]
        let userAgent: String
        let clientID: String
        let version: String
    }

    /// Innertube clients that return caption tracks without a proof-of-origin
    /// token; WEB and MWEB do not. The second covers the first being retired.
    private static let clients: [PlayerClient] = [
        PlayerClient(
            context: [
                "clientName": .string("ANDROID"), "clientVersion": .string("20.10.38"),
                "androidSdkVersion": .number(30), "hl": .string("en"), "gl": .string("US"),
            ],
            userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
            clientID: "3",
            version: "20.10.38"
        ),
        PlayerClient(
            context: [
                "clientName": .string("IOS"), "clientVersion": .string("20.10.4"),
                "deviceMake": .string("Apple"), "deviceModel": .string("iPhone16,2"),
                "osName": .string("iPhone"), "osVersion": .string("18.3.2.22D82"),
                "hl": .string("en"), "gl": .string("US"),
            ],
            userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
            clientID: "5",
            version: "20.10.4"
        ),
    ]

    private struct PlayerResponse: Decodable {
        struct Playability: Decodable { var status: String?; var reason: String? }
        struct Details: Decodable { var title: String?; var author: String?; var lengthSeconds: String? }
        struct Captions: Decodable {
            struct Renderer: Decodable { var captionTracks: [CaptionTrack]? }
            var playerCaptionsTracklistRenderer: Renderer?
        }
        var playabilityStatus: Playability?
        var videoDetails: Details?
        var captions: Captions?
    }

    /// Fetch a video's captions from this device's own connection. `onStage`
    /// hears each step in words the composer can show while the user waits.
    static func fetch(
        _ link: Link,
        session: URLSession = .shared,
        onStage: @MainActor @Sendable (String) -> Void
    ) async throws -> Transcript {
        await onStage("Finding the video...")
        var lastReason = ""
        for client in clients {
            var request = URLRequest(url: URL(string: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false")!)
            request.httpMethod = "POST"
            request.timeoutInterval = 20
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(client.userAgent, forHTTPHeaderField: "User-Agent")
            request.setValue(client.clientID, forHTTPHeaderField: "X-YouTube-Client-Name")
            request.setValue(client.version, forHTTPHeaderField: "X-YouTube-Client-Version")
            let body: JSONValue = .object([
                "context": .object(["client": .object(client.context)]),
                "videoId": .string(link.videoID),
                "contentCheckOk": .bool(true),
                "racyCheckOk": .bool(true),
            ])
            request.httpBody = try JSONEncoder().encode(body)

            let player: PlayerResponse
            do {
                let (data, response) = try await session.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                    lastReason = "YouTube didn't answer."
                    continue
                }
                player = try JSONDecoder().decode(PlayerResponse.self, from: data)
            } catch {
                lastReason = "Couldn't reach YouTube. Check your connection and try again."
                continue
            }

            let tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
            if player.playabilityStatus?.status != "OK", tracks.isEmpty {
                lastReason = player.playabilityStatus?.reason.map { "YouTube says: \($0)" }
                    ?? "YouTube would not open this video."
                continue
            }
            guard let chosen = chooseTrack(tracks) else {
                // The next client may still see tracks this one was not given.
                lastReason = noCaptions
                continue
            }

            let title = player.videoDetails?.title?.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? "Untitled video"
            let length = Int(player.videoDetails?.lengthSeconds ?? "") ?? 0
            let lengthNote = length > 0 ? " (\(timestamp(ms: length * 1000)))" : ""
            await onStage("Reading the captions of \"\(title.prefix(48))\"\(lengthNote)...")

            var captionURL = chosen.track.baseUrl.replacingOccurrences(
                of: #"&fmt=[^&]*"#, with: "", options: .regularExpression
            ) + "&fmt=json3"
            if chosen.translated { captionURL += "&tlang=en" }
            guard let url = URL(string: captionURL) else {
                lastReason = "YouTube didn't send the captions."
                continue
            }
            var captionRequest = URLRequest(url: url)
            captionRequest.timeoutInterval = 20
            captionRequest.setValue(client.userAgent, forHTTPHeaderField: "User-Agent")
            let captions: Json3
            do {
                let (data, response) = try await session.data(for: captionRequest)
                guard (response as? HTTPURLResponse)?.statusCode == 200, !data.isEmpty else {
                    lastReason = "YouTube didn't send the captions."
                    continue
                }
                captions = try JSONDecoder().decode(Json3.self, from: data)
            } catch {
                lastReason = "YouTube didn't send the captions."
                continue
            }

            let paragraphs = paragraphs(from: captions)
            guard !paragraphs.isEmpty else {
                lastReason = "The captions for this video are empty."
                continue
            }
            return Transcript(
                videoID: link.videoID,
                title: title,
                channel: player.videoDetails?.author?.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? "Unknown channel",
                lengthSeconds: length,
                automatic: chosen.track.kind == "asr",
                translated: chosen.translated,
                languageCode: chosen.track.languageCode,
                paragraphs: paragraphs
            )
        }
        if lastReason == noCaptions { throw Failure(message: noCaptions) }
        throw Failure(message: "Couldn't get this video's transcript. \(lastReason.isEmpty ? "Try again in a moment." : lastReason)")
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
