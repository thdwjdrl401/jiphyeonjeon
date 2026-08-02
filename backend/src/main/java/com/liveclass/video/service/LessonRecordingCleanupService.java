package com.liveclass.video.service;

import com.liveclass.video.api.LessonRecordingCleanup;
import com.liveclass.video.config.EgressProperties;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.repository.VideoAssetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.List;
import java.util.UUID;

/**
 * 강의 삭제에 딸린 녹화 정리(포트 {@link LessonRecordingCleanup} 구현).
 *
 * <p><b>순서가 이 클래스의 요점이다.</b> 자산 행은 트랜잭션 안에서 지우고, 스토리지 객체는
 * <b>커밋된 뒤에만</b> 지운다. 반대로 하면 트랜잭션이 되돌아갔을 때 강의는 그대로인데 영상만
 * 사라진다 — 복구 수단이 없는 손실이다. 커밋 뒤 삭제는 최악의 경우 "파일이 남는" 쪽으로만 어긋난다.
 *
 * <p>파일 삭제 실패는 강의 삭제를 되돌리지 않는다. 이미 커밋됐고, 되돌릴 수도 없다. 대신 <b>남은
 * 경로를 로그에 남겨</b> 나중에 손으로 지울 수 있게 한다 — 조용히 삼키면 어디에 쓰레기가 남았는지
 * 아무도 모른다.
 */
@Service
public class LessonRecordingCleanupService implements LessonRecordingCleanup {

    private static final Logger log = LoggerFactory.getLogger(LessonRecordingCleanupService.class);

    private final VideoAssetRepository repository;
    private final RecordingStorage storage;
    private final EgressProperties egress;
    private final ApplicationEventPublisher events;

    public LessonRecordingCleanupService(VideoAssetRepository repository,
                                         RecordingStorage storage,
                                         EgressProperties egress,
                                         ApplicationEventPublisher events) {
        this.repository = repository;
        this.storage = storage;
        this.egress = egress;
        this.events = events;
    }

    @Override
    @Transactional
    public int deleteByLesson(UUID lessonId) {
        List<VideoAsset> assets = repository.findByLessonIdIn(List.of(lessonId));
        if (assets.isEmpty()) {
            return 0;
        }
        // 산출물 경로는 세션 단위다(RecordingObjectKeys). 행을 지우기 전에 모아 둔다 — 지운 뒤에는 알 수 없다.
        List<String> prefixes = assets.stream()
                .map(VideoAsset::getLiveSessionId)
                .filter(java.util.Objects::nonNull)
                .map(RecordingObjectKeys::objectPrefix)
                .toList();
        repository.deleteAll(assets);
        events.publishEvent(new RecordingObjectsOrphaned(lessonId, prefixes));
        log.info("강의 삭제에 따른 녹화 자산 제거 lessonId={} assets={} prefixes={}",
                lessonId, assets.size(), prefixes.size());
        return assets.size();
    }

    /** 커밋 뒤에만 실제 파일을 지운다 — 롤백됐다면 이 리스너는 아예 돌지 않는다. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void deleteObjects(RecordingObjectsOrphaned event) {
        for (String prefix : event.prefixes()) {
            try {
                long deleted = storage.deletePrefix(egress.bucket(), prefix);
                log.info("녹화 산출물 삭제 lessonId={} prefix={} objects={}", event.lessonId(), prefix, deleted);
            } catch (RuntimeException e) {
                // 강의는 이미 지워졌다. 여기서 던져도 되돌릴 것이 없으므로, 남은 경로를 남기고 계속한다.
                log.warn("녹화 산출물 삭제 실패 — 스토리지에 파일이 남았을 수 있습니다. "
                        + "bucket={} prefix={} lessonId={} 사유={}",
                        egress.bucket(), prefix, event.lessonId(), e.getMessage());
            }
        }
    }

    /** 자산 행이 사라져 주인이 없어진 산출물 경로. 커밋 뒤 정리 대상. */
    public record RecordingObjectsOrphaned(UUID lessonId, List<String> prefixes) {
    }
}
