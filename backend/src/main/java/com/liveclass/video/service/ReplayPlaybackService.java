package com.liveclass.video.service;

import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionView;
import com.liveclass.video.PlaybackPaths;
import com.liveclass.video.api.LessonPlaybackAccess;
import com.liveclass.video.api.PlaybackAccessGrant;
import com.liveclass.video.config.EgressProperties;
import com.liveclass.video.config.PlaybackProperties;
import com.liveclass.video.domain.ReplayStatus;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.web.dto.PlaybackResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * 라이브 recent/dvr와 종료 후 VOD 재생을 같은 lesson 기반 API로 제공한다(choinhoo/0001).
 * DB 접근 뒤 MinIO I/O를 수행하므로 이 서비스 전체를 transaction으로 감싸지 않는다.
 */
@Service
public class ReplayPlaybackService {

    private static final Logger log = LoggerFactory.getLogger(ReplayPlaybackService.class);
    private static final Set<String> LIVE_PLAYBACK_STATUSES = Set.of("LIVE", "ENDING");

    private final VideoAssetRepository videoAssetRepository;
    private final LessonPlaybackAccess playbackAccess;
    private final ReplayStorage replayStorage;
    private final LiveSessionDirectory liveSessionDirectory;
    private final EgressProperties egressProperties;
    private final PlaybackProperties playbackProperties;
    private final HlsManifestProcessor manifestProcessor;

    public ReplayPlaybackService(VideoAssetRepository videoAssetRepository,
                                 LessonPlaybackAccess playbackAccess,
                                 ReplayStorage replayStorage,
                                 LiveSessionDirectory liveSessionDirectory,
                                 EgressProperties egressProperties,
                                 PlaybackProperties playbackProperties,
                                 HlsManifestProcessor manifestProcessor) {
        this.videoAssetRepository = videoAssetRepository;
        this.playbackAccess = playbackAccess;
        this.replayStorage = replayStorage;
        this.liveSessionDirectory = liveSessionDirectory;
        this.egressProperties = egressProperties;
        this.playbackProperties = playbackProperties;
        this.manifestProcessor = manifestProcessor;
    }

    /** 재생 source와 세션 상대 시간 범위를 반환한다. 라이브 manifest 생성 지연은 null source다. */
    public PlaybackResponse playback(UUID userId, UUID lessonId) {
        PlaybackContext context = requirePlaybackContext(userId, lessonId);
        VideoAsset asset = context.asset();
        LiveSessionView session = context.session();

        // STARTING 중 Gate C가 이미 manifest를 만들었더라도 학생 source는 LIVE 원자 전환 뒤에만 공개한다.
        Optional<HlsManifestProcessor.ManifestSnapshot> snapshot =
                context.phase() == PlaybackPhase.STARTING ? Optional.empty() : findSnapshot(asset, session);
        if (context.phase() == PlaybackPhase.REPLAY && snapshot.isEmpty()) {
            log.warn("종료된 READY 자산의 재생목록 부재 lesson={} key={}", lessonId, manifestKey(asset));
            throw new ReplayNotReadyException("다시보기를 재생할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        }

        PlaybackResponse.Source source = snapshot.map(s -> toSource(lessonId, s)).orElse(null);

        return new PlaybackResponse(
                asset.getLessonId(),
                asset.getId(),
                session.sessionId(),
                session.startedAt(),
                session.liveSessionStatus(),
                source != null ? source.availableToMs() : null,
                snapshot.map(HlsManifestProcessor.ManifestSnapshot::sessionOffsetMs).orElse(null),
                asset.getDurationMs(),
                source);
    }

    /**
     * 세그먼트 URI를 presigned GET으로 재작성한 HLS manifest 본문을 반환한다.
     *
     * <p>라이브 중에는 {@code CAN-SKIP-UNTIL}을 광고해 플레이어가 델타를 요청하게 하고,
     * {@code _HLS_skip=YES}로 온 요청에는 경계보다 오래된 세그먼트를 생략한 본문을 준다. 생략을 먼저
     * 하고 재작성하므로 남은 세그먼트만 서명한다 — 델타의 요점이다.
     *
     * <p>종료 후 재생목록은 {@code #EXT-X-ENDLIST}가 있어 플레이어가 다시 받지 않으므로 손대지 않는다.
     */
    public String manifest(UUID userId, UUID lessonId, boolean deltaRequested) {
        PlaybackContext context = requirePlaybackContext(userId, lessonId);
        if (context.phase() == PlaybackPhase.STARTING) {
            throw new RecordingStartingException("라이브 송출을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.");
        }
        VideoAsset asset = context.asset();
        String key = manifestKey(asset);
        String raw = findManifest(asset.getBucket(), key).orElseThrow(() -> {
            if (context.phase() == PlaybackPhase.LIVE) {
                return new RecordingStartingException("녹화 재생목록이 생성 중입니다. 잠시 후 다시 시도해 주세요.");
            }
            return new ReplayNotReadyException("다시보기 재생목록을 찾을 수 없습니다.");
        });

        try {
            String body = raw;
            if (manifestProcessor.isLive(body)) {
                if (deltaRequested) {
                    body = manifestProcessor.skip(body, playbackProperties.canSkipUntil());
                }
                body = manifestProcessor.withServerControl(body, playbackProperties.canSkipUntil());
            }
            return manifestProcessor.rewrite(
                    body, asset.getBucket(), key, playbackProperties.segmentUrlTtl());
        } catch (ReplayManifestInvalidException e) {
            throw e;
        } catch (RuntimeException e) {
            throw storageUnavailable(e);
        }
    }

    private PlaybackContext requirePlaybackContext(UUID userId, UUID lessonId) {
        PlaybackAccessGrant grant = playbackAccess.resolve(userId, lessonId);
        VideoAsset asset = videoAssetRepository.findByLessonId(lessonId)
                .orElseThrow(() -> new ReplayNotFoundException("이 레슨에는 녹화 자산이 없습니다."));
        LiveSessionView session = liveSessionDirectory.findById(asset.getLiveSessionId())
                .orElseThrow(() -> new ReplayNotFoundException("라이브 세션을 찾을 수 없습니다."));
        PlaybackPhase phase = playbackPhase(session.liveSessionStatus());

        if (phase != PlaybackPhase.LIVE && phase != PlaybackPhase.STARTING
                && !grant.owner()
                && asset.getReplayStatus() != ReplayStatus.PUBLISHED) {
            throw new ReplayNotFoundException("게시된 다시보기가 없습니다.");
        }
        if (asset.getEgressId() == null || asset.getStatus() == VideoAssetStatus.FAILED) {
            throw new ReplayNotReadyException("녹화가 아직 재생 가능한 상태가 아닙니다.");
        }
        if (phase == PlaybackPhase.REPLAY && asset.getStatus() != VideoAssetStatus.READY) {
            throw new ReplayNotReadyException("다시보기가 아직 준비되지 않았습니다.");
        }
        if (phase == PlaybackPhase.UNAVAILABLE) {
            throw new ReplayNotReadyException("현재 세션 상태에서는 재생할 수 없습니다.");
        }
        return new PlaybackContext(asset, session, phase);
    }

    private Optional<HlsManifestProcessor.ManifestSnapshot> findSnapshot(VideoAsset asset,
                                                                        LiveSessionView session) {
        return findManifest(asset.getBucket(), manifestKey(asset))
                .map(raw -> manifestProcessor.analyze(raw, session.startedAt()));
    }

    private Optional<String> findManifest(String bucket, String key) {
        try {
            return replayStorage.findManifest(bucket, key);
        } catch (RuntimeException e) {
            throw storageUnavailable(e);
        }
    }

    private PlaybackStorageUnavailableException storageUnavailable(RuntimeException cause) {
        return new PlaybackStorageUnavailableException("재생 스토리지에 연결할 수 없습니다.", cause);
    }

    private PlaybackResponse.Source toSource(UUID lessonId,
                                             HlsManifestProcessor.ManifestSnapshot snapshot) {
        return new PlaybackResponse.Source(
                PlaybackPaths.manifest(lessonId),
                snapshot.availableFromMs(),
                snapshot.availableToMs());
    }

    /**
     * 재생목록 키 = {@code sessions/{sessionId}/index.m3u8}. 라이브 중에는 ENDLIST 없이 자라는
     * EVENT 재생목록이고, 종료 후 같은 객체에 ENDLIST가 붙어 VOD가 된다 — 그래서 하나로 충분하다.
     */
    private String manifestKey(VideoAsset asset) {
        if (asset.getHlsManifestKey() != null && !asset.getHlsManifestKey().isBlank()) {
            return asset.getHlsManifestKey();
        }
        return RecordingObjectKeys.manifestKey(
                asset.getLiveSessionId(), egressProperties.playlistName());
    }

    private PlaybackPhase playbackPhase(String status) {
        if ("STARTING".equals(status)) {
            return PlaybackPhase.STARTING;
        }
        if (LIVE_PLAYBACK_STATUSES.contains(status)) {
            return PlaybackPhase.LIVE;
        }
        if ("ENDED".equals(status)) {
            return PlaybackPhase.REPLAY;
        }
        return PlaybackPhase.UNAVAILABLE;
    }

    private enum PlaybackPhase {
        STARTING,
        LIVE,
        REPLAY,
        UNAVAILABLE
    }

    private record PlaybackContext(
            VideoAsset asset,
            LiveSessionView session,
            PlaybackPhase phase
    ) {
    }
}
