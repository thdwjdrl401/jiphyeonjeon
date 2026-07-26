package com.liveclass.video.service;

import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionView;
import com.liveclass.video.api.LessonPlaybackAccess;
import com.liveclass.video.api.PlaybackAccessException;
import com.liveclass.video.api.PlaybackAccessGrant;
import com.liveclass.video.config.EgressProperties;
import com.liveclass.video.domain.ReplayStatus;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.web.dto.PlaybackResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 다시보기 재생·게시(ADR-0039, ARCHITECTURE §9-8·§9-9). 권한 게이트는 curriculum이 구현한
 * {@link LessonPlaybackAccess}로 위임하고, 게시·자산 상태 게이트와 매니페스트 재작성·시간축 앵커는 여기서 처리한다.
 *
 * <p><b>매니페스트 재작성</b>: 스토리지의 {@code index.m3u8}을 텍스트로 읽어 세그먼트 URI를 presigned GET URL로
 * 바꿔 응답에 인라인으로 싣는다(원칙 4 — 바이트는 앱 서버를 통과하지 않는다). 별도 GET이 아니라 인라인으로 준 건
 * hls.js가 blob/data-URI로 바로 물릴 수 있어 왕복이 줄고, 각 세그먼트가 presigned라 추가 인증이 필요 없기 때문.
 *
 * <p><b>시간축 앵커</b>: 매니페스트 첫 {@code #EXT-X-PROGRAM-DATE-TIME}에서 절대 시각을 뽑아 세션 시작시각과의
 * 차이를 오프셋 하나로 내려준다. PDT나 세션 시작시각이 없으면 null로 degrade(에러 아님).
 */
@Service
public class ReplayPlaybackService {

    private static final Logger log = LoggerFactory.getLogger(ReplayPlaybackService.class);
    private static final String PDT_TAG = "#EXT-X-PROGRAM-DATE-TIME:";
    /** {@code #EXT-X-MAP}·{@code #EXT-X-KEY} 태그 안의 {@code URI="..."} 속성 — fMP4 초기화 세그먼트·암호화 키 참조. */
    private static final Pattern TAG_URI_ATTR = Pattern.compile("URI=\"([^\"]*)\"");

    private final VideoAssetRepository videoAssetRepository;
    private final LessonPlaybackAccess playbackAccess;
    private final ReplayStorage replayStorage;
    private final LiveSessionDirectory liveSessionDirectory;
    private final EgressProperties egressProperties;

    public ReplayPlaybackService(VideoAssetRepository videoAssetRepository,
                                 LessonPlaybackAccess playbackAccess,
                                 ReplayStorage replayStorage,
                                 LiveSessionDirectory liveSessionDirectory,
                                 EgressProperties egressProperties) {
        this.videoAssetRepository = videoAssetRepository;
        this.playbackAccess = playbackAccess;
        this.replayStorage = replayStorage;
        this.liveSessionDirectory = liveSessionDirectory;
        this.egressProperties = egressProperties;
    }

    /**
     * 재생 정보(재작성된 매니페스트 + 시간축 오프셋)를 만든다.
     *
     * <p>게이트 순서: (1) 접근 판정 — 소유 강사이거나 활성 수강생(아니면 403/404, {@link LessonPlaybackAccess}).
     * (2) 자산 존재 — 없으면 404. (3) 학생은 PUBLISHED만(미게시는 404로 은닉), 소유 강사는 게시 전에도 검수.
     * (4) 자산 READY — 아니면 409.
     */
    @Transactional(readOnly = true)
    public PlaybackResponse playback(UUID userId, UUID lessonId) {
        PlaybackAccessGrant grant = playbackAccess.resolve(userId, lessonId);

        VideoAsset asset = videoAssetRepository.findByLessonId(lessonId)
                .orElseThrow(() -> new ReplayNotFoundException("이 레슨에는 다시보기가 없습니다."));

        if (!grant.owner() && asset.getReplayStatus() != ReplayStatus.PUBLISHED) {
            // 학생에겐 미게시 다시보기의 존재를 드러내지 않는다 — 404.
            throw new ReplayNotFoundException("이 레슨에는 다시보기가 없습니다.");
        }
        if (asset.getStatus() != VideoAssetStatus.READY) {
            throw new ReplayNotReadyException("다시보기가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.");
        }

        String bucket = asset.getBucket();
        String manifestKey = manifestKey(asset);
        String raw;
        try {
            raw = replayStorage.readManifest(bucket, manifestKey);
        } catch (ReplayManifestMissingException e) {
            // 자산은 READY라고 기록돼 있지만 스토리지에 실제 파일이 없다(retention_until 만료 등으로
            // 파일만 먼저 사라지는 엣지케이스) — 부재가 아니라 지금 재생 불가라는 뜻이라 409로 다룬다.
            log.warn("자산 READY인데 매니페스트 부재 lesson={} key={}", lessonId, manifestKey);
            throw new ReplayNotReadyException("다시보기가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.");
        }

        String prefix = keyPrefix(manifestKey);
        Duration ttl = Duration.ofSeconds(egressProperties.playbackUrlTtlSeconds());
        String rewritten = rewriteManifest(raw, bucket, prefix, ttl);
        Long offsetMs = computeSessionOffsetMs(raw, asset.getLiveSessionId());

        return new PlaybackResponse(rewritten, offsetMs, asset.getDurationMs());
    }

    /**
     * 다시보기를 PUBLISHED로 전환한다(FE 501 경로 {@code POST /instructor/lessons/{id}/replay-review/publish}).
     * 소유 강사만(아니면 403), 자산이 READY여야(아니면 409) 게시할 수 있다. 검수 데이터(자막 교정 등) 저장은
     * CP2 산출물이 없어 범위 밖 — 여기서는 공개 상태 전환만 한다(ADR-0039).
     */
    @Transactional
    public void publish(UUID userId, UUID lessonId) {
        // 게시는 소유 강사 전용이라 "미수강"이라는 학생 개념이 의미가 없다 — resolve()가 무엇을 이유로
        // 실패하든(레슨 없음·미수강 등) 소유자가 아니라는 뜻이므로 전부 403 REPLAY_FORBIDDEN으로 통일한다.
        boolean owner;
        try {
            owner = playbackAccess.resolve(userId, lessonId).owner();
        } catch (PlaybackAccessException e) {
            owner = false;
        }
        if (!owner) {
            throw new ReplayForbiddenException("이 레슨의 소유 강사만 다시보기를 게시할 수 있습니다.");
        }
        VideoAsset asset = videoAssetRepository.findByLessonId(lessonId)
                .orElseThrow(() -> new ReplayPublishConflictException("게시할 다시보기가 없습니다."));
        if (asset.getStatus() != VideoAssetStatus.READY) {
            throw new ReplayPublishConflictException("녹화가 준비(READY)된 뒤에 게시할 수 있습니다.");
        }
        if (asset.getReplayStatus() == ReplayStatus.PUBLISHED) {
            return;   // 이미 게시 — 멱등.
        }
        asset.setReplayStatus(ReplayStatus.PUBLISHED);
        asset.setPublishedBy(userId);
        asset.setPublishedAt(OffsetDateTime.now());
        log.info("다시보기 게시 lesson={} by={}", lessonId, userId);
    }

    /**
     * 매니페스트의 세그먼트 URI를 presigned GET URL로 재작성한다.
     * <ul>
     *   <li>일반 세그먼트 줄(URI만 있는 줄) — {@code #}로 시작하는 태그·빈 줄은 그대로, 나머지는 URI로 본다.
     *   <li>{@code #EXT-X-MAP:URI="..."}·{@code #EXT-X-KEY:URI="..."} — fMP4 초기화 세그먼트·암호화 키 참조도
     *       세그먼트와 같은 스토리지 객체라 <b>태그 안의 URI 속성값</b>도 재작성한다. 지금 Egress 설정(TS,
     *       비암호화)에선 안 나오지만 fMP4·암호화로 바뀌면 이 재작성이 없으면 조용히 깨진다.
     *   <li>절대 URL(http/https)은 이미 서명됐거나 외부 자원이라 재작성 불가 — 그대로 두고 WARN 로그만 남긴다.
     * </ul>
     * 상대 URI는 {@link #normalizeRelativeKey}로 정규화(선행 {@code ./} 제거, {@code //} 축약) 후
     * 매니페스트와 같은 디렉토리 프리픽스를 붙여 스토리지 키로 환산해 presign한다.
     */
    private String rewriteManifest(String manifest, String bucket, String keyPrefix, Duration ttl) {
        String[] lines = manifest.split("\n", -1);
        StringBuilder out = new StringBuilder(manifest.length() + 512);
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String trimmed = line.strip();
            if (trimmed.startsWith("#EXT-X-MAP:") || trimmed.startsWith("#EXT-X-KEY:")) {
                out.append(rewriteTagUri(line, bucket, keyPrefix, ttl));
            } else if (!trimmed.isEmpty() && !trimmed.startsWith("#")) {
                out.append(rewriteSegmentLine(trimmed, bucket, keyPrefix, ttl));
            } else {
                out.append(line);
            }
            if (i < lines.length - 1) {
                out.append('\n');
            }
        }
        return out.toString();
    }

    /** 세그먼트 URI 한 줄을 presigned URL로(절대 URL이면 그대로 + WARN). */
    private String rewriteSegmentLine(String uri, String bucket, String keyPrefix, Duration ttl) {
        if (isAbsoluteUrl(uri)) {
            log.warn("세그먼트가 이미 절대 URL이라 재작성하지 않음 — presign 대상이 아닐 수 있다: {}", uri);
            return uri;
        }
        return replayStorage.presignSegment(bucket, keyPrefix + normalizeRelativeKey(uri), ttl);
    }

    /** {@code #EXT-X-MAP:URI="..."} 같은 태그 줄에서 {@code URI="..."} 속성값만 presigned URL로 바꾼다. */
    private String rewriteTagUri(String line, String bucket, String keyPrefix, Duration ttl) {
        Matcher matcher = TAG_URI_ATTR.matcher(line);
        if (!matcher.find()) {
            return line;   // URI 속성이 없는 태그 — 그대로.
        }
        String uri = matcher.group(1);
        String replacement = isAbsoluteUrl(uri)
                ? uri
                : replayStorage.presignSegment(bucket, keyPrefix + normalizeRelativeKey(uri), ttl);
        if (isAbsoluteUrl(uri)) {
            log.warn("태그 내 URI가 이미 절대 URL이라 재작성하지 않음: {}", uri);
        }
        return new StringBuilder(line).replace(matcher.start(1), matcher.end(1),
                Matcher.quoteReplacement(replacement)).toString();
    }

    /**
     * 상대 세그먼트 URI를 스토리지 키 조각으로 정규화한다 — 선행 {@code ./}를 제거하고 연속 {@code //}를
     * 하나로 축약한다. Egress 출력은 보통 {@code seg_00000.ts} 그대로지만, 다른 패키저·수동 편집 매니페스트가
     * {@code ./seg_00000.ts}를 낼 수 있어 방어한다.
     */
    private String normalizeRelativeKey(String uri) {
        String normalized = uri.startsWith("./") ? uri.substring(2) : uri;
        return normalized.replaceAll("/{2,}", "/");
    }

    /**
     * 첫 {@code #EXT-X-PROGRAM-DATE-TIME}(세그먼트 0의 절대 시각)과 세션 시작시각의 차이를 ms로 뽑는다(§9-9).
     * PDT가 없거나 세션·시작시각을 못 구하면 null(degrade — 에러 아님).
     */
    private Long computeSessionOffsetMs(String manifest, UUID liveSessionId) {
        OffsetDateTime firstPdt = firstProgramDateTime(manifest);
        if (firstPdt == null) {
            return null;
        }
        LiveSessionView session = liveSessionDirectory.findById(liveSessionId).orElse(null);
        if (session == null || session.startedAt() == null) {
            return null;
        }
        return Duration.between(session.startedAt(), firstPdt).toMillis();
    }

    private OffsetDateTime firstProgramDateTime(String manifest) {
        for (String line : manifest.split("\n", -1)) {
            String trimmed = line.strip();
            if (trimmed.startsWith(PDT_TAG)) {
                String value = trimmed.substring(PDT_TAG.length()).strip();
                try {
                    return OffsetDateTime.parse(value);
                } catch (DateTimeParseException e) {
                    log.debug("PDT 파싱 실패 — 오프셋 degrade value={}", value);
                    return null;
                }
            }
        }
        return null;
    }

    private boolean isAbsoluteUrl(String uri) {
        return uri.startsWith("http://") || uri.startsWith("https://");
    }

    /** VOD 매니페스트 키 = {@code sessions/{sessionId}/index.m3u8}. 저장된 키가 있으면 그것을, 없으면 규약으로 파생. */
    private String manifestKey(VideoAsset asset) {
        if (asset.getHlsManifestKey() != null && !asset.getHlsManifestKey().isBlank()) {
            return asset.getHlsManifestKey();
        }
        return "sessions/" + asset.getLiveSessionId() + "/" + egressProperties.playlistName();
    }

    /** 매니페스트 키의 디렉토리 프리픽스(마지막 {@code /}까지). 세그먼트 상대 URI를 절대 키로 만들 때 붙인다. */
    private String keyPrefix(String manifestKey) {
        int slash = manifestKey.lastIndexOf('/');
        return slash < 0 ? "" : manifestKey.substring(0, slash + 1);
    }
}
