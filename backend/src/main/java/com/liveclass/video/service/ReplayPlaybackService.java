package com.liveclass.video.service;

import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionView;
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
    private static final Set<String> LIVE_PLAYBACK_STATUSES = Set.of("STARTING", "LIVE", "ENDING");

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

    /** 재생 가능한 source와 세션 상대 시간 범위를 반환한다. 라이브 manifest 생성 지연은 null source다. */
    public PlaybackResponse playback(UUID userId, UUID lessonId) {
        PlaybackContext context = requirePlaybackContext(userId, lessonId);
        VideoAsset asset = context.asset();
        LiveSessionView session = context.session();

        Optional<ManifestData> recent = context.phase() == PlaybackPhase.LIVE
                ? findManifestData(asset, session, PlaybackSource.RECENT)
                : Optional.empty();
        Optional<ManifestData> dvr = findManifestData(asset, session, PlaybackSource.DVR);

        if (context.phase() == PlaybackPhase.REPLAY && dvr.isEmpty()) {
            log.warn("종료된 READY 자산의 DVR manifest 부재 lesson={} key={}", lessonId, dvrKey(asset));
            throw new ReplayNotReadyException("다시보기를 재생할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        }

        PlaybackResponse.Source recentSource = recent
                .map(data -> toSource(lessonId, PlaybackSource.RECENT, data.snapshot()))
                .orElse(null);
        PlaybackResponse.Source dvrSource = dvr
                .map(data -> toSource(lessonId, PlaybackSource.DVR, data.snapshot()))
                .orElse(null);
        Long currentSessionMs = recentSource != null
                ? recentSource.availableToMs()
                : dvrSource != null ? dvrSource.availableToMs() : null;
        Long sessionOffsetMs = dvr.map(data -> data.snapshot().sessionOffsetMs()).orElse(null);

        return new PlaybackResponse(
                asset.getLessonId(),
                asset.getId(),
                session.sessionId(),
                session.startedAt(),
                session.liveSessionStatus(),
                currentSessionMs,
                sessionOffsetMs,
                asset.getDurationMs(),
                new PlaybackResponse.Sources(recentSource, dvrSource));
    }

    /** 요청한 source의 URI를 presigned GET으로 재작성한 HLS manifest 본문을 반환한다. */
    public String manifest(UUID userId, UUID lessonId, String sourceValue) {
        PlaybackSource source = PlaybackSource.from(sourceValue);
        PlaybackContext context = requirePlaybackContext(userId, lessonId);
        if (source == PlaybackSource.RECENT && context.phase() != PlaybackPhase.LIVE) {
            throw new ReplayNotReadyException("종료된 세션에는 recent 재생 source가 없습니다.");
        }

        VideoAsset asset = context.asset();
        String key = manifestKey(asset, source);
        Optional<String> raw = findManifest(asset.getBucket(), key);
        if (raw.isEmpty()) {
            if (context.phase() == PlaybackPhase.LIVE) {
                throw new RecordingStartingException("녹화 재생목록이 생성 중입니다. 잠시 후 다시 시도해 주세요.");
            }
            throw new ReplayNotReadyException("다시보기 재생목록을 찾을 수 없습니다.");
        }

        try {
            return manifestProcessor.rewrite(
                    raw.get(), asset.getBucket(), key, playbackProperties.segmentUrlTtl());
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

        if (phase != PlaybackPhase.LIVE
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

    private Optional<ManifestData> findManifestData(VideoAsset asset,
                                                    LiveSessionView session,
                                                    PlaybackSource source) {
        String key = manifestKey(asset, source);
        return findManifest(asset.getBucket(), key)
                .map(raw -> new ManifestData(raw, manifestProcessor.analyze(raw, session.startedAt())));
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
                                             PlaybackSource source,
                                             HlsManifestProcessor.ManifestSnapshot snapshot) {
        return new PlaybackResponse.Source(
                "/api/lessons/" + lessonId + "/playback/manifest?source=" + source.value(),
                snapshot.availableFromMs(),
                snapshot.availableToMs());
    }

    private String manifestKey(VideoAsset asset, PlaybackSource source) {
        return source == PlaybackSource.RECENT ? recentKey(asset) : dvrKey(asset);
    }

    private String recentKey(VideoAsset asset) {
        return RecordingObjectKeys.manifestKey(
                asset.getLiveSessionId(), egressProperties.livePlaylistName());
    }

    private String dvrKey(VideoAsset asset) {
        if (asset.getHlsManifestKey() != null && !asset.getHlsManifestKey().isBlank()) {
            return asset.getHlsManifestKey();
        }
        return RecordingObjectKeys.manifestKey(
                asset.getLiveSessionId(), egressProperties.playlistName());
    }

    private PlaybackPhase playbackPhase(String status) {
        if (LIVE_PLAYBACK_STATUSES.contains(status)) {
            return PlaybackPhase.LIVE;
        }
        if ("ENDED".equals(status)) {
            return PlaybackPhase.REPLAY;
        }
        return PlaybackPhase.UNAVAILABLE;
    }

    private enum PlaybackPhase {
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

    private record ManifestData(
            String raw,
            HlsManifestProcessor.ManifestSnapshot snapshot
    ) {
    }
}
