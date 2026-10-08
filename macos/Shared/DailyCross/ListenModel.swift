import AVFoundation
import Foundation
import MediaPlayer

#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Playback and polling for "Listen" - today's spoken devotional.
///
/// Port of the stateful half of `mobile/src/features/cross/ListenCard.tsx` and
/// `src/components/cross/ListenCard.tsx`; the pure rules it leans on live in
/// `Listen.swift`. As on Android 1.78.0+, narration is made on request:
/// opening reads status once, the narrator setup panel's "Generate audio
/// narrative" is the only POST, and only a pending generation (or this
/// client's own request in flight) is polled.
///
/// Owned by `DailyCrossModel` rather than the view, for the reason the day
/// itself is: the Daily Cross pane is destroyed every time the sidebar moves,
/// and a listen must not stop because the user glanced at chat. That is also
/// what makes the macOS Now Playing item honest - the audio outlives the pane
/// drawing its controls.
@MainActor
@Observable
final class ListenModel {
    // MARK: - Published state

    private(set) var audio: DailyCrossAudio?
    /// The failed card's message. Set only by a real dead end: the opening
    /// status read failing, the poll timeout, a requested generation that
    /// failed, or a playback failure that has spent its silent retries.
    private(set) var failureText: String?
    /// This client's own generation request is in flight. The card shows
    /// "preparing" for its whole length, as Android does.
    private(set) var isRequesting = false
    private(set) var isPlaying = false
    private(set) var currentTime: Double = 0
    /// The player's real duration once the file is loaded.
    private(set) var itemDuration: Double = 0
    /// The speed chip, seeded from `SettingsStore.listenRate` by the view.
    private(set) var rate: Double = Listen.defaultRate

    var transcriptOpen = false
    /// Non-nil while the scrubber is being dragged: the position the thumb is
    /// at, which the rail and the elapsed clock follow instead of the player.
    var scrubTarget: Double?

    /// Today's verse, shown as the subtitle on the OS media card so a Now
    /// Playing item says which day's word is speaking.
    var reference: String?

    /// Android's `requesting ? "preparing" : failureText ? "failed" : listenPhase(audio)`.
    var phase: ListenPhase {
        if isRequesting { return .preparing }
        if failureText != nil { return .failed }
        return Listen.phase(audio)
    }

    /// The player's duration once loaded; the server's word-count estimate
    /// before that, so the total never reads 0:00 while buffering.
    var duration: Double {
        itemDuration > 0 ? itemDuration : (audio?.durationSec ?? 0)
    }

    /// Real seconds at every speed - the clock reports the file, not the pace.
    var elapsed: Double { scrubTarget ?? currentTime }

    var progress: Double { Listen.progress(currentTime: elapsed, duration: duration) }

    // MARK: - Dependencies

    private let transport: ListenTransport
    private let mintToken: TokenProvider

    convenience init(api: APIClient, token: @escaping TokenProvider = ClerkAuth.tokenProvider) {
        self.init(transport: .live(api: api), token: token)
    }

    init(transport: ListenTransport, token: @escaping TokenProvider = ClerkAuth.tokenProvider) {
        self.transport = transport
        self.mintToken = token
    }

    /// The narrator catalog, for the setup panel.
    func voices() async throws -> NarrationVoices {
        try await transport.voices()
    }

    // MARK: - Player plumbing

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?
    private var rateObservation: NSKeyValueObservation?
    private var notificationTokens: [any NSObjectProtocol] = []
    private var remoteTargets: [(MPRemoteCommand, Any)] = []

    /// The opening status read. Cleared when it finishes, so `begin()` can
    /// read again; `lifecycleRun` stops a superseded read clearing its
    /// successor.
    private var lifecycle: Task<Void, Never>?
    private var lifecycleRun = 0
    /// The poll loop while preparing, with the same superseded-run guard.
    private var pollTask: Task<Void, Never>?
    private var pollRun = 0
    /// This client's own generation request.
    private var requestTask: Task<Void, Never>?
    private var playerTask: Task<Void, Never>?
    private var stallTask: Task<Void, Never>?
    private var steadyTask: Task<Void, Never>?
    private var failureTask: Task<Void, Never>?

    /// When this client received the signed URL, and whether the current source
    /// has already spent its one token refresh / one URL refresh.
    private var urlFetchedAt: Date?
    private var tokenRetried = false
    private var urlRefreshed = false

    /// Which audio the current player was built from - see
    /// `Listen.sourceIdentity`. `streamUrl` cannot answer this: it is the same
    /// path every day.
    private var sourceIdentity: String?

    /// Rises with every player built. One dead item reports itself twice - a
    /// `.failed` status through KVO *and* `AVPlayerItemFailedToPlayToEndTime` -
    /// and the second report used to burn the next recovery stage and raise the
    /// failure card while the first one's retry was still in flight. A report
    /// stamped with a superseded generation is that echo, and is dropped.
    private var playerGeneration = 0
    /// Set while a recovery is being run, so the two reports of a single fault
    /// that arrive before any rebuild cannot both start one.
    private var handlingFailure = false
    /// Faults since the last *sustained* stretch of playback. A momentary
    /// `.playing` no longer clears this, which is what stops a flapping source
    /// retrying forever without ever telling the listener.
    private var consecutiveFailures = 0

    /// When the OS media card last got the truth, so a 4 Hz time observer does
    /// not rebuild its dictionary four times a second.
    private var nowPlayingPushedAt: Date?

    /// Where to pick a listen back up after a rebuild, and whether it was
    /// playing when it died.
    private var resumeAt: Double = 0
    private var resumePlaying = false

    // MARK: - Lifecycle

    /// Read today's status (and poll it if a generation is pending). Re-runnable:
    /// it coalesces while a read is in flight, but once that read has finished
    /// the next call reads again - which is what lets a reopened sheet, a new
    /// day or a replaced word re-ask the server. Android gets the same by
    /// remounting its card per day (`key={entry.id}`). A listen already in
    /// progress is left alone: the re-read only rebuilds the player if the
    /// source really moved (`Listen.sourceIdentity`).
    ///
    /// Returns the read's task so tests can await it.
    @discardableResult
    func begin() -> Task<Void, Never>? {
        if let lifecycle { return lifecycle }
        lifecycleRun &+= 1
        let run = lifecycleRun
        let task = Task { [weak self] in
            await self?.openingRead()
            guard let self, !Task.isCancelled, run == self.lifecycleRun else { return }
            self.lifecycle = nil
            self.startPolling()
        }
        lifecycle = task
        return task
    }

    /// Drop everything and stop the audio: a new day's word has landed, or the
    /// session ended. The Now Playing item goes with it.
    func reset() {
        lifecycle?.cancel()
        lifecycle = nil
        lifecycleRun &+= 1
        pollTask?.cancel()
        pollTask = nil
        pollRun &+= 1
        requestTask?.cancel()
        requestTask = nil
        isRequesting = false
        playerTask?.cancel()
        stallTask?.cancel()
        steadyTask?.cancel()
        failureTask?.cancel()
        teardownPlayer()
        audio = nil
        failureText = nil
        currentTime = 0
        itemDuration = 0
        transcriptOpen = false
        scrubTarget = nil
        urlFetchedAt = nil
        tokenRetried = false
        urlRefreshed = false
        sourceIdentity = nil
        handlingFailure = false
        consecutiveFailures = 0
        resumeAt = 0
        resumePlaying = false
    }

    /// The status read on opening. A failure here, before anything is known,
    /// is the failed card with Android's "Couldn't load audio. Try again." -
    /// but only then: a re-read failing under a card that already has a state
    /// keeps that state.
    private func openingRead() async {
        do {
            let next = try await transport.state()
            guard !Task.isCancelled else { return }
            apply(next)
        } catch {
            guard !Task.isCancelled, audio == nil else { return }
            failureText = Listen.loadFailureText
        }
    }

    /// Poll every `Listen.pollInterval` while the card is preparing - a
    /// pending generation, or this client's own request in flight - and give
    /// up after `Listen.pollTimeout` rather than shimmer forever. Idempotent.
    private func startPolling() {
        guard pollTask == nil, Listen.shouldPoll(phase) else { return }
        pollRun &+= 1
        let run = pollRun
        pollTask = Task { [weak self] in
            await self?.poll()
            guard let self, run == self.pollRun else { return }
            self.pollTask = nil
        }
    }

    private func poll() async {
        let startedAt = Date.now
        while !Task.isCancelled, Listen.shouldPoll(phase) {
            if Date.now.timeIntervalSince(startedAt) > Listen.pollTimeout {
                failureText = Listen.failureText
                return
            }
            try? await Task.sleep(for: Listen.pollInterval)
            // The request may have landed during the sleep.
            guard !Task.isCancelled, Listen.shouldPoll(phase) else { return }
            await load()
        }
    }

    private func load() async {
        do {
            let next = try await transport.state()
            guard !Task.isCancelled else { return }
            apply(next)
        } catch {
            // A failed poll is not a failed generation: the next tick retries,
            // and the poll timeout is what eventually surfaces a problem.
        }
    }

    /// Record a server payload, stamping when this client received its URL and
    /// rebuilding the player if the source moved.
    ///
    /// "Moved" is `Listen.sourceIdentity`, not `streamUrl` - see the note
    /// there. A source that really moved is also a fresh chance, so it lifts
    /// the failure latch. `rebuild` forces a fresh player for the same source:
    /// a generate request answered with the narration that already exists
    /// (the failed card after a dead playback) must get a working player, not
    /// the dead one. The server reuses a ready row rather than billing a
    /// second narration, so that request costs nothing.
    private func apply(_ next: DailyCrossAudio, rebuild: Bool = false) {
        let identity = Listen.sourceIdentity(next)
        let moved = identity != sourceIdentity
        audio = next
        urlFetchedAt = next.url != nil ? .now : nil
        if moved || (rebuild && identity != nil) {
            sourceIdentity = identity
            tokenRetried = false
            urlRefreshed = false
            consecutiveFailures = 0
            if next.status == .ready { failureText = nil }
            rebuildPlayer()
        }
        updateNowPlaying()
    }

    /// "Generate audio narrative": the explicit request, and the only thing
    /// that ever POSTs. A port of Android's `retry(options)`.
    ///
    /// The card reads "preparing" for the whole request, and the status is
    /// polled alongside it. A request that errors (it can time out while the
    /// server is still narrating) falls back to one status read: pending or
    /// ready carries on, anything else is the failed card.
    @discardableResult
    func generate(_ options: NarrationOptions) -> Task<Void, Never>? {
        guard !isRequesting else { return requestTask }
        isRequesting = true
        failureText = nil
        let task = Task { [weak self] in
            guard let self else { return }
            // The POST is what reaches ElevenLabs; "Not now" puts the card
            // back on Try again.
            guard await AIConsentGate.ensure() else {
                failed = true
                return
            }
            do {
                let result = try await transport.generate(options)
                guard !Task.isCancelled else { return }
                apply(result, rebuild: result.status == .ready)
                if result.status == .failed { failureText = Listen.failureText }
            } catch {
                guard !Task.isCancelled else { return }
                do {
                    let state = try await transport.state()
                    guard !Task.isCancelled else { return }
                    apply(state)
                    if state.status != .pending, state.status != .ready {
                        failureText = Listen.prepareFailureText
                    }
                } catch {
                    guard !Task.isCancelled else { return }
                    failureText = Listen.prepareFailureText
                }
            }
            isRequesting = false
            requestTask = nil
            startPolling()
        }
        requestTask = task
        startPolling()
        return task
    }

    // MARK: - Building the player

    /// Play through our own API rather than the signed blob URL - the same
    /// proxy web and Android use, and for the same reason (see the stream
    /// route: media loaders will not open a presigned private-blob URL, even
    /// though `fetch` of it succeeds).
    ///
    /// That means the player has to carry the Clerk bearer itself.
    /// `AVURLAsset`'s header option is how: it keeps AVFoundation's own
    /// `Range` requests and progressive buffering, which an
    /// `AVAssetResourceLoaderDelegate` would have to reimplement by hand. The
    /// token is minted fresh here because it is short-lived and is only proved
    /// when the asset opens its first connection - the same reason Android
    /// mints one into `AudioSource.headers`.
    private func rebuildPlayer() {
        playerTask?.cancel()
        stallTask?.cancel()
        steadyTask?.cancel()
        teardownPlayer()
        // Everything the outgoing item still has to say about itself is now an
        // echo of a player nobody is listening to.
        playerGeneration &+= 1

        guard let path = audio?.streamUrl,
              let url = URL(string: path, relativeTo: Config.apiURL)?.absoluteURL
        else { return }

        let mint = mintToken
        playerTask = Task { [weak self] in
            let jwt = try? await mint(true)
            guard !Task.isCancelled else { return }
            self?.install(url: url, jwt: jwt)
        }
    }

    private func install(url: URL, jwt: String?) {
        activateAudioSession()
        let generation = playerGeneration

        var options: [String: Any] = [:]
        if let jwt {
            // AVFoundation has carried this key since iOS 5; it is the only
            // supported way to authenticate an `AVURLAsset` without giving up
            // its Range handling.
            options["AVURLAssetHTTPHeaderFieldsKey"] = ["Authorization": "Bearer \(jwt)"]
        }

        let item = AVPlayerItem(asset: AVURLAsset(url: url, options: options))
        // Keeps a devotional at 1.5x sounding like a person reading quickly
        // rather than a chipmunk - Android's `shouldCorrectPitch`.
        item.audioTimePitchAlgorithm = .timeDomain

        let player = AVPlayer(playerItem: item)
        player.actionAtItemEnd = .pause
        self.player = player

        statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            let status = item.status
            let seconds = item.duration.isNumeric ? item.duration.seconds : 0
            Task { @MainActor [weak self] in
                self?.itemStatusChanged(status, duration: seconds, generation: generation)
            }
        }

        // `timeControlStatus` is the honest answer to "is sound coming out"; a
        // non-zero `rate` is set the instant Play is pressed, well before the
        // first byte arrives.
        rateObservation = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] player, _ in
            let playing = player.timeControlStatus == .playing
            Task { @MainActor [weak self] in self?.playbackStatusChanged(playing) }
        }

        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated { self?.tick(time) }
        }

        observe(.AVPlayerItemDidPlayToEndTime, on: item) { model in model.finished() }
        observe(.AVPlayerItemFailedToPlayToEndTime, on: item) { model in
            model.reportPlaybackFailure(generation: generation)
        }

        registerRemoteCommands()
        updateNowPlaying()
    }

    private func observe(
        _ name: Notification.Name,
        on item: AVPlayerItem,
        handler: @escaping @MainActor (ListenModel) -> Void
    ) {
        let token = NotificationCenter.default.addObserver(
            forName: name,
            object: item,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                handler(self)
            }
        }
        notificationTokens.append(token)
    }

    private func teardownPlayer() {
        if let player, let timeObserver {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        statusObservation = nil
        rateObservation = nil
        for token in notificationTokens { NotificationCenter.default.removeObserver(token) }
        notificationTokens = []
        player?.pause()
        player = nil
        isPlaying = false
        currentTime = 0
        itemDuration = 0
        unregisterRemoteCommands()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped
    }

    /// iOS needs a playback session before anything is audible; macOS has no
    /// session to claim. Spoken audio is its own mode, which is what tells the
    /// system this is a voice and not music.
    private func activateAudioSession() {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio)
        try? session.setActive(true)
        #endif
    }

    // MARK: - Player events

    private func itemStatusChanged(
        _ status: AVPlayerItem.Status,
        duration seconds: Double,
        generation: Int
    ) {
        guard generation == playerGeneration else { return }
        if seconds.isFinite, seconds > 0 { itemDuration = seconds }

        switch status {
        case .readyToPlay:
            // A rebuilt player lands back where the dead one stopped rather
            // than at the beginning.
            if resumeAt > 0 {
                let target = resumeAt
                resumeAt = 0
                seek(to: target)
                if resumePlaying {
                    resumePlaying = false
                    play()
                }
            }
        case .failed:
            reportPlaybackFailure(generation: generation)
        default:
            break
        }
        updateNowPlaying()
    }

    private func playbackStatusChanged(_ playing: Bool) {
        isPlaying = playing
        if playing {
            stallTask?.cancel()
            // Sound is coming out, so a speed the listener chose while the
            // player was still `.waitingToPlayAtSpecifiedRate` can finally be
            // honoured - `playImmediately(atRate:)` and a mid-buffer `rate`
            // write are both overwritten when playback actually starts.
            if let player, player.rate != Float(rate) { player.rate = Float(rate) }
            // NOT the point at which the recovery stages re-arm: see
            // `armSteadyWatch`.
            armSteadyWatch()
        } else {
            steadyTask?.cancel()
        }
        updateNowPlaying()
    }

    /// Playback that lasted rather than flickered: this, and only this, gives
    /// the source its silent retries back.
    private func armSteadyWatch() {
        steadyTask?.cancel()
        steadyTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Listen.playbackSteady))
            guard !Task.isCancelled, let self, self.isPlaying else { return }
            self.tokenRetried = false
            self.urlRefreshed = false
            self.consecutiveFailures = 0
        }
    }

    private func tick(_ time: CMTime) {
        guard scrubTarget == nil else { return }
        currentTime = time.seconds.isFinite ? time.seconds : 0
        if itemDuration <= 0,
           let itemSeconds = player?.currentItem?.duration,
           itemSeconds.isNumeric {
            itemDuration = itemSeconds.seconds
        }
        // The OS interpolates the playhead from `ElapsedPlaybackTime` and
        // `PlaybackRate`, so a media card only needs the truth about once a
        // second. Rebuilding the whole dictionary at the observer's 4 Hz was
        // work no one could see - every transport change below still pushes
        // immediately, which is what the card actually reacts to.
        let now = Date.now
        if let last = nowPlayingPushedAt, now.timeIntervalSince(last) < 1 { return }
        updateNowPlaying()
    }

    /// A finished devotional rewinds, so Play starts it again rather than doing
    /// nothing at the very end of the track.
    private func finished() {
        seek(to: 0)
        isPlaying = false
        updateNowPlaying()
    }

    /// One report of a playback fault.
    ///
    /// A single dead item reports itself twice - `status == .failed` through
    /// KVO and `AVPlayerItemFailedToPlayToEndTime` - and used to spawn two
    /// recoveries: the second burned the URL-refresh stage and raised the
    /// failure card while the first one's token retry was still in flight. The
    /// generation stamp drops echoes from a player already replaced, and
    /// `handlingFailure` drops the twin that arrives before any rebuild.
    private func reportPlaybackFailure(generation: Int) {
        guard generation == playerGeneration, !handlingFailure else { return }
        handlingFailure = true
        failureTask?.cancel()
        failureTask = Task { [weak self] in
            await self?.handlePlaybackFailure(generation: generation)
            self?.handlingFailure = false
        }
    }

    /// Playback never started, or died.
    ///
    /// Two things can be stale, so try the cheap one first: the bearer the
    /// asset carries lives about a minute and is only proved when it opens a
    /// connection, so a stall earns one fresh token and a rebuilt player before
    /// anything is called a failure. Failing that, a devotional state this
    /// client has been sitting on for a while earns one silent re-read. Either
    /// way they land back where they were; a source opened moments ago that
    /// stalls is a real failure and says so.
    ///
    /// Bounded twice over. `consecutiveFailures` survives a momentary
    /// `.playing` (only `Listen.playbackSteady` of real playback clears it), so
    /// a source that opens and dies on the next byte can no longer re-arm both
    /// stages forever - a Clerk mint and a stream-route hit every eight
    /// seconds with nothing ever surfaced. And each attempt waits out
    /// `Listen.failureBackoff` first.
    private func handlePlaybackFailure(generation: Int) async {
        guard generation == playerGeneration else { return }
        consecutiveFailures += 1
        guard !Listen.shouldSurfaceFailure(consecutiveFailures: consecutiveFailures) else {
            failureText = Listen.failureText
            return
        }

        try? await Task.sleep(for: Listen.failureBackoff(attempt: consecutiveFailures))
        guard !Task.isCancelled, generation == playerGeneration else { return }

        if !tokenRetried, audio?.streamUrl != nil {
            tokenRetried = true
            resumeAt = currentTime
            resumePlaying = true
            rebuildPlayer()
            return
        }

        guard Listen.shouldRefreshURL(urlFetchedAt: urlFetchedAt, alreadyRetried: urlRefreshed) else {
            failureText = Listen.failureText
            return
        }
        urlRefreshed = true
        resumeAt = currentTime
        resumePlaying = true
        do {
            let fresh = try await transport.state()
            guard fresh.status == .ready, fresh.streamUrl != nil else {
                failureText = Listen.failureText
                return
            }
            audio = fresh
            urlFetchedAt = fresh.url != nil ? .now : nil
            // Recorded so a later poll does not read the re-signed row as a
            // second move and rebuild the player underneath this one.
            sourceIdentity = Listen.sourceIdentity(fresh)
            rebuildPlayer()
        } catch {
            failureText = Listen.failureText
        }
    }

    // MARK: - Transport

    func togglePlay() {
        isPlaying ? pause() : play()
    }

    func play() {
        guard let player else { return }
        player.playImmediately(atRate: Float(rate))
        armStallWatch()
        updateNowPlaying()
    }

    func pause() {
        stallTask?.cancel()
        player?.pause()
        isPlaying = false
        updateNowPlaying()
    }

    /// Nothing playing this long after Play means the source never opened.
    private func armStallWatch() {
        stallTask?.cancel()
        let generation = playerGeneration
        stallTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Listen.playbackStall))
            guard !Task.isCancelled, let self, !self.isPlaying else { return }
            self.reportPlaybackFailure(generation: generation)
        }
    }

    /// Apply the stored speed. A rebuilt player (a new token, a new day) starts
    /// at 1x, so this is called from the card whenever either changes rather
    /// than once on load.
    func setRate(_ next: Double) {
        rate = Listen.normalizeRate(next)
        // `isPlaying` follows `timeControlStatus == .playing`, so gating on it
        // silently dropped every speed change made while the player was still
        // `.waitingToPlayAtSpecifiedRate` - which is most of the first few
        // seconds of a devotional, and exactly when a listener reaches for the
        // chip. A non-zero `rate` means the player is trying to play, and the
        // new speed is its speed. `playbackStatusChanged` re-applies it on the
        // transition to real playback, since starting resets the rate.
        if let player, player.rate != 0 { player.rate = Float(rate) }
        updateNowPlaying()
    }

    func seek(to seconds: Double) {
        guard let player else { return }
        let bounded = max(0, min(duration > 0 ? duration : seconds, seconds))
        currentTime = bounded
        player.seek(
            to: CMTime(seconds: bounded, preferredTimescale: 600),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
        updateNowPlaying()
    }

    func skip(by seconds: Double) {
        seek(to: currentTime + seconds)
    }

    /// Drag ended: commit the thumb's position to the player.
    func endScrub() {
        guard let target = scrubTarget else { return }
        scrubTarget = nil
        seek(to: target)
    }

    // MARK: - Now Playing

    /// How far the OS media card's skip buttons jump. 10s to match Android,
    /// whose media service fixes the interval and offers no way to change it.
    static let skipInterval: Double = 10

    /// The app icon, as the OS media card's artwork. Built once - it is the
    /// same square mark web hands `MediaMetadata` and Android fetches over
    /// https.
    private static let artwork: MPMediaItemArtwork? = {
        #if os(macOS)
        let image = NSImage(named: NSImage.applicationIconName)
        #else
        let image = UIImage(named: "AppIcon")
        #endif
        guard let image else { return nil }
        return MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }()

    private func updateNowPlaying() {
        nowPlayingPushedAt = .now
        let center = MPNowPlayingInfoCenter.default()
        guard phase == .ready, player != nil else {
            center.nowPlayingInfo = nil
            center.playbackState = .stopped
            return
        }

        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = audio?.title ?? "Today's devotional"
        // The same two lines Android and web give the OS: what is speaking, and
        // which day's word it is.
        info[MPMediaItemPropertyArtist] = reference.map { "Pick Up Your Cross · \($0)" }
            ?? "Pick Up Your Cross"
        info[MPMediaItemPropertyAlbumTitle] = "SureWord"
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? rate : 0
        if let artwork = Self.artwork { info[MPMediaItemPropertyArtwork] = artwork }

        center.nowPlayingInfo = info
        center.playbackState = isPlaying ? .playing : .paused
    }

    /// Media keys, the menu-bar Now Playing item and Control Center.
    ///
    /// Nothing documents which thread these handlers arrive on, so none of them
    /// assumes main - `MainActor.assumeIsolated` in a remote-command handler is
    /// a hard crash the first time the system chooses otherwise, from a hardware
    /// media key on a locked screen. Each hops with `Task { @MainActor }` and
    /// answers `.success` for the transport it accepted.
    private func registerRemoteCommands() {
        guard remoteTargets.isEmpty else { return }
        let center = MPRemoteCommandCenter.shared()

        add(center.playCommand) { $0.play() }
        add(center.pauseCommand) { $0.pause() }
        add(center.togglePlayPauseCommand) { $0.togglePlay() }

        center.skipBackwardCommand.preferredIntervals = [NSNumber(value: Self.skipInterval)]
        center.skipForwardCommand.preferredIntervals = [NSNumber(value: Self.skipInterval)]
        add(center.skipBackwardCommand) { $0.skip(by: -Self.skipInterval) }
        add(center.skipForwardCommand) { $0.skip(by: Self.skipInterval) }

        let seekTarget = center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            let position = event.positionTime
            Task { @MainActor in self?.seek(to: position) }
            return .success
        }
        remoteTargets.append((center.changePlaybackPositionCommand, seekTarget))
        center.changePlaybackPositionCommand.isEnabled = true
    }

    private func add(
        _ command: MPRemoteCommand,
        handler: @escaping @MainActor (ListenModel) -> Void
    ) {
        let target = command.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                handler(self)
            }
            return .success
        }
        command.isEnabled = true
        remoteTargets.append((command, target))
    }

    /// Drop the targets *and* disable the commands. Leaving them enabled with
    /// nothing behind them tells the system SureWord still handles the media
    /// keys, so a press after the listen ended goes nowhere instead of to
    /// whatever is actually playing.
    private func unregisterRemoteCommands() {
        for (command, target) in remoteTargets {
            command.removeTarget(target)
            command.isEnabled = false
        }
        remoteTargets = []
    }

    /// The model outlives every view that draws it (that is the point - a
    /// listen must not stop because the sidebar moved), so the last release can
    /// happen anywhere, and nothing else will clean up after it: a live
    /// periodic time observer keeps the `AVPlayer` alive, notification tokens
    /// and remote-command targets keep the model itself alive, and the poll
    /// loop would keep asking the server about a devotional nobody is holding.
    isolated deinit {
        lifecycle?.cancel()
        pollTask?.cancel()
        requestTask?.cancel()
        playerTask?.cancel()
        stallTask?.cancel()
        steadyTask?.cancel()
        failureTask?.cancel()
        if let player, let timeObserver { player.removeTimeObserver(timeObserver) }
        statusObservation?.invalidate()
        rateObservation?.invalidate()
        for token in notificationTokens { NotificationCenter.default.removeObserver(token) }
        for (command, target) in remoteTargets {
            command.removeTarget(target)
            command.isEnabled = false
        }
        player?.pause()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped
    }
}
