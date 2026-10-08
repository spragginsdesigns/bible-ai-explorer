import Foundation
import Testing
@testable import SureWord

/// Ported from `mobile/src/features/chat/videoTranscript.test.ts`.
@Suite("Video transcripts for /verify")
struct VideoTranscriptTests {

    @Test("Reads every YouTube link shape", arguments: [
        "https://youtu.be/GMwihA5jnhY?is=3s-53jq8-8hFmTb8",
        "https://www.youtube.com/watch?v=GMwihA5jnhY&t=120s",
        "https://m.youtube.com/watch?v=GMwihA5jnhY",
        "https://youtube.com/shorts/GMwihA5jnhY?feature=share",
        "https://www.youtube.com/live/GMwihA5jnhY",
        "https://www.youtube.com/embed/GMwihA5jnhY",
        "youtu.be/GMwihA5jnhY",
    ])
    func readsLinks(url: String) {
        #expect(VideoTranscript.videoID(from: url) == "GMwihA5jnhY")
    }

    @Test("Refuses what is not a video", arguments: [
        "https://www.youtube.com/@PowerfulJRE",
        "https://www.youtube.com/watch?v=short",
        "https://www.tiktok.com/@someone/video/7299466335934532906",
        "https://notyoutube.com/watch?v=GMwihA5jnhY",
        "not a link",
    ])
    func refusesOthers(url: String) {
        #expect(VideoTranscript.videoID(from: url) == nil)
    }

    @Test("Only a /verify message with a YouTube link is a video")
    func verifyRequest() {
        #expect(VideoTranscript.verifyRequest("/verify https://youtu.be/GMwihA5jnhY")?.videoID == "GMwihA5jnhY")
        #expect(VideoTranscript.verifyRequest("/VERIFY  https://youtu.be/GMwihA5jnhY")?.videoID == "GMwihA5jnhY")
        #expect(VideoTranscript.verifyRequest("/verify Jesus never claimed to be God") == nil)
        #expect(VideoTranscript.verifyRequest("/check https://youtu.be/GMwihA5jnhY") == nil)
        #expect(VideoTranscript.verifyRequest("/verifying https://youtu.be/GMwihA5jnhY") == nil)
        #expect(VideoTranscript.findLink(in: "Watch this! https://youtu.be/GMwihA5jnhY?si=abc so good")
            == .init(url: "https://youtu.be/GMwihA5jnhY?si=abc", videoID: "GMwihA5jnhY"))
    }

    @Test("Leaves punctuation off the id and refuses lookalike domains")
    func punctuationAndLookalikes() {
        #expect(VideoTranscript.findLink(in: "/verify https://youtu.be/GMwihA5jnhY.")?.videoID == "GMwihA5jnhY")
        #expect(VideoTranscript.findLink(in: "watch https://youtube.com/watch?v=GMwihA5jnhY!")?.videoID == "GMwihA5jnhY")
        #expect(VideoTranscript.findLink(in: "https://youtu.be/GMwihA5jnhY, it's wild")?.videoID == "GMwihA5jnhY")
        #expect(VideoTranscript.findLink(in: "https://notyoutube.com/watch?v=GMwihA5jnhY") == nil)
        #expect(VideoTranscript.findLink(in: "https://fake-youtube.com/watch?v=GMwihA5jnhY") == nil)
        #expect(VideoTranscript.findLink(in: "(https://www.youtube.com/watch?v=GMwihA5jnhY)")?.videoID == "GMwihA5jnhY")
    }

    @Test("Prefers uploaded English, then automatic, then a translation")
    func choosesTrack() {
        let auto = VideoTranscript.CaptionTrack(baseUrl: "a", languageCode: "en", kind: "asr")
        let manual = VideoTranscript.CaptionTrack(baseUrl: "m", languageCode: "en-US")
        let spanish = VideoTranscript.CaptionTrack(baseUrl: "s", languageCode: "es", isTranslatable: true)
        #expect(VideoTranscript.chooseTrack([auto, manual])?.track == manual)
        #expect(VideoTranscript.chooseTrack([spanish, auto])?.track == auto)
        #expect(VideoTranscript.chooseTrack([spanish])?.translated == true)
        #expect(VideoTranscript.chooseTrack([]) == nil)
    }

    @Test("Folds caption events into stamped 30 second paragraphs")
    func paragraphs() throws {
        let json = """
        {"events":[
          {"tStartMs":0,"segs":[{"utf8":"In the beginning"},{"utf8":" was the Word"}]},
          {"tStartMs":4000,"segs":[{"utf8":"\\n"}]},
          {"tStartMs":12000,"segs":[{"utf8":"and the Word was with God"}]},
          {"tStartMs":31000,"segs":[{"utf8":"and the Word was God."}]},
          {"tStartMs":3725000,"segs":[{"utf8":"Amen."}]}
        ]}
        """
        let captions = try JSONDecoder().decode(VideoTranscript.Json3.self, from: Data(json.utf8))
        #expect(VideoTranscript.paragraphs(from: captions) == [
            "[0:00] In the beginning was the Word and the Word was with God",
            "[0:31] and the Word was God.",
            "[1:02:05] Amen.",
        ])
    }

    @Test("Leads with the header and cuts an over-long transcript at a paragraph")
    func fileText() {
        var transcript = VideoTranscript.Transcript(
            videoID: "GMwihA5jnhY",
            title: "Joe Rogan Experience #2562 - Dan McClellan",
            channel: "PowerfulJRE",
            lengthSeconds: 9353,
            automatic: true,
            translated: false,
            languageCode: "en",
            paragraphs: ["[0:00] Hello.", "[0:30] Second."]
        )
        let text = VideoTranscript.fileText(transcript)
        #expect(text.contains("Length: 2:35:53"))
        #expect(text.contains("automatic captions"))
        #expect(text.hasSuffix("[0:00] Hello.\n\n[0:30] Second.\n"))

        let long = "[1:00:00] " + String(repeating: "word ", count: 2000)
        transcript.paragraphs = Array(repeating: long, count: 200)
        let cut = VideoTranscript.fileText(transcript)
        #expect(cut.utf8.count <= VideoTranscript.maxBytes)
        #expect(cut.contains("[Transcript cut off after 1:00:00 to fit."))
    }

    @Test("Names the file and the last status the way Android does")
    func namesAndStatus() {
        #expect(VideoTranscript.filename(for: "Joe Rogan Experience #2562 - Dan McClellan")
            == "YouTube-transcript-Joe-Rogan-Experience-2562-Dan-McClellan.txt")
        #expect(VideoTranscript.filename(for: "🙏🙏") == "YouTube-transcript-video.txt")
        #expect(VideoTranscript.sendingStatus(lengthSeconds: 45) == "Sending SureWord the transcript...")
        #expect(VideoTranscript.sendingStatus(lengthSeconds: 730)
            == "Sending SureWord the transcript (12 minutes of video)...")
        #expect(VideoTranscript.sendingStatus(lengthSeconds: 9353)
            == "Sending SureWord the transcript (2.6 hours of video, so the answer takes a minute or two)...")
    }
}
