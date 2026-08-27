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
/// `Listen.swift`. The card never asks for a narration: the day and its audio
/// are made together server-side, so this polls until the scheduled generation
/// lands and only ever POSTs from the failed card's "Try again".
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
    /// Set only by a real dead end: the poll timeout, or a playback failure
    /// that has already spent both of its silent retries.
    private(set) var failed = false
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

    var phase: ListenPhase { failed ? .failed : Listen.phase(audio) }

    /// The player's duration once loaded; the server's word-count estimate
    /// before that, so the total never reads 0:00 while buffering.
    var duration: Double {
        itemDuration > 0 ? itemDuration : (audio?.durationSec ?? 0)
    }

    /// Real seconds at every speed - the clock reports the file, not the pace.
    var elapsed: Double { scrubTarget ?? currentTime }

    var progress: Double { Listen.progress(currentTime: elapsed, duration: duration) }

    // MARK: - Dependencies

    private let api: APIClient
    private let mintToken: TokenProvider

    init(api: APIClient, token: @escaping TokenProvider = ClerkAuth.tokenProvider) {
        self.api = api
        self.mintToken = token
    }

    // MARK: - Player plumbing

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?
    private var rateObservation: NSKeyValueObservation?
    private var notificationTokens: [any NSObjectProtocol] = []
    private var remoteTargets: [(MPRemoteCommand, Any)] = []

    private var lifecycle: Task<Void, Never>?
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

    /// Start (or resume) the poll loop. Idempotent - the card's `.task` calls
    /// it on every appearance, and a listen already in progress is left alone.
    func begin() {
        guard lifecycle == nil || lifecycle?.isCancelled == true else { return }
        lifecycle = Task { [weak self] in await self?.run() }
    }

    /// Drop everything and stop the audio: a new day's word has landed, or the
    /// session ended. The Now Playing item goes with it.
    func reset() {
        lifecycle?.cancel()
        lifecycle = nil
        playerTask?.cancel()
        stallTask?.cancel()
        steadyTask?.cancel()
        failureTask?.cancel()
        teardownPlayer()
        audio = nil
        failed = false
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

    private func run() async {
        await load()
        let startedAt = Date.now
        while !Task.isCancelled, Listen.shouldPoll(phase) {
            if Date.now.timeIntervalSince(startedAt) > Listen.pollTimeout {
                failed = true
                return
            }
            try? await Task.sleep(for: Listen.pollInterval)
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    private func load() async {
        do {
            apply(try await ListenAPI.state(api: api))
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
    /// the failure latch: without that, one dead playback left the card stuck
    /// on "Try again" forever, and "Try again" POSTs, which routes a playback
    /// fault through the generation endpoint and bills an ElevenLabs call for
    /// a narration that already exists.
    private func apply(_ next: DailyCrossAudio) {
        let identity = Listen.sourceIdentity(next)
        let moved = identity != sourceIdentity
        audio = next
        urlFetchedAt = next.url != nil ? .now : nil
        if moved {
            sourceIdentity = identity
            tokenRetried = false
            urlRefreshed = false
            consecutiveFailures = 0
            if next.status == .ready { failed = false }
            rebuildPlayer()
        }
        updateNowPlaying()
    }

    /// The manual retry, and the only thing that ever POSTs.
    func retry() {
        failed = false
        lifecycle?.cancel()
        lifecycle = Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await ListenAPI.retry(api: api)
                apply(result)
                if result.status == .failed { failed = true }
            } catch {
                // The request itself can time out while the server is still
                // narrating, so fall back to polling rather than declaring
                // failure here.
                await load()
            }
            guard !Task.isCancelled else { return }
            await run()
        }
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
            failed = true
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
            failed = true
            return
        }
        urlRefreshed = true
        resumeAt = currentTime
        resumePlaying = true
        do {
            let fresh = try await ListenAPI.state(api: api)
            guard fresh.status == .ready, fresh.streamUrl != nil else {
                failed = true
                return
            }
            audio = fresh
            urlFetchedAt = fresh.url != nil ? .now : nil
            // Recorded so a later poll does not read the re-signed row as a
            // second move and rebuild the player underneath this one.
            sourceIdentity = Listen.sourceIdentity(fresh)
            rebuildPlayer()
        } catch {
            failed = true
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
