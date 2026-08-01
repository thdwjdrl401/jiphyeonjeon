package com.liveclass.live.service;

import com.liveclass.live.domain.LiveAnnotationOp;
import com.liveclass.live.domain.LiveAnnotationSnapshot;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.repository.LiveAnnotationOpRepository;
import com.liveclass.live.repository.LiveAnnotationSnapshotRepository;
import com.liveclass.live.repository.LiveSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 판서 op 적재·복원(ADR-0051, CONTRACT §3-6b).
 *
 * <p><b>여기는 라이브 경로가 아니다.</b> 수강생에게 판서가 도달하는 경로는 LiveKit 데이터 채널
 * → Egress이고, 이 서비스는 그와 <b>병렬로</b> 기록만 남긴다. 그래서 저장 실패가 강사 화면이나
 * 수강생 화면을 막지 않는다 — 막으면 획을 그을 때마다 HTTP 왕복이 그리는 동작에 끼어든다.
 */
@Service
public class LiveAnnotationService {

    private static final Logger log = LoggerFactory.getLogger(LiveAnnotationService.class);

    /** 스냅샷 op의 타입 이름. 문서 복원의 시작점이다. */
    private static final String SNAPSHOT = "snapshot";

    private final LiveAnnotationOpRepository repository;
    private final SessionClockLookup sessionClock;
    private final LiveSessionRepository sessionRepository;
    private final LiveAnnotationSnapshotRepository snapshotRepository;

    public LiveAnnotationService(LiveAnnotationOpRepository repository, SessionClockLookup sessionClock,
                                 LiveSessionRepository sessionRepository,
                                 LiveAnnotationSnapshotRepository snapshotRepository) {
        this.repository = repository;
        this.sessionClock = sessionClock;
        this.sessionRepository = sessionRepository;
        this.snapshotRepository = snapshotRepository;
    }

    /**
     * 복원 체크포인트를 저장한다(ADR-0057). 세션당 한 행이라 새 것이 오면 덮어쓴다.
     *
     * <p>이것이 없으면 복원이 세션 시작부터 전부 내려온다 — 실측에서 op 233건이 983kB였다.
     */
    @Transactional
    public void saveSnapshot(UUID sessionId, long revision, String payload) {
        LiveAnnotationSnapshot snapshot = snapshotRepository.findById(sessionId)
                .orElseGet(() -> {
                    LiveAnnotationSnapshot created = new LiveAnnotationSnapshot();
                    created.setSessionId(sessionId);
                    return created;
                });
        // 뒤로 가는 체크포인트는 무시한다. 창이 둘 열려 있으면 늦게 온 것이 더 옛 문서일 수 있다.
        if (snapshot.getPayload() != null && snapshot.getRevision() >= revision) return;
        snapshot.setRevision(revision);
        snapshot.setPayload(payload);
        snapshot.setUpdatedAt(OffsetDateTime.now());
        snapshotRepository.save(snapshot);
    }

    /**
     * 판서 표시 상태를 바꾼다(ADR-0056).
     *
     * <p>판서 <b>내용</b>이 아니라 "지금 보여주는가"다. 강사가 새로고침해도 이전 상태로 돌아와야
     * 하고, 그래야 <b>강사 화면과 수강생 화면이 갈리지 않는다</b> — 이 값이 없으면 강사는 꺼진
     * 화면을 보는데 Egress는 자기 문서를 계속 그린다.
     */
    @Transactional
    public void setVisible(UUID sessionId, boolean visible) {
        sessionRepository.findById(sessionId).ifPresent(session -> session.setAnnotationVisible(visible));
    }

    /** 지금 표시 중인가. 세션이 없으면 false — 없는 세션의 판서를 보여줄 이유가 없다. */
    @Transactional(readOnly = true)
    public boolean isVisible(UUID sessionId) {
        return sessionRepository.findById(sessionId).map(LiveSession::isAnnotationVisible).orElse(false);
    }

    /**
     * op를 적재한다. 같은 `(sessionId, revision)`이 이미 있으면 조용히 넘어간다 — 강사가 재전송해도
     * 로그가 부풀지 않아야 하고, 저장은 어차피 best-effort다.
     *
     * @return 실제로 저장했으면 true
     */
    @Transactional
    public boolean append(UUID sessionId, long revision, String opType, String payload, OffsetDateTime occurredAt) {
        if (repository.existsBySessionIdAndRevision(sessionId, revision)) {
            return false;
        }
        LiveAnnotationOp entity = new LiveAnnotationOp();
        entity.setSessionId(sessionId);
        entity.setRevision(revision);
        entity.setOpType(opType);
        entity.setPayload(payload);
        // 다시보기에서 "강사가 이걸 강조한 순간"으로 이동하는 앵커. 자막과 같은 축을 쓴다(ADR-0045).
        entity.setSessionMs(sessionClock.approxSessionMs(sessionId, occurredAt));
        entity.setOccurredAt(occurredAt);
        entity.setReceivedAt(OffsetDateTime.now());
        repository.save(entity);
        return true;
    }

    /**
     * 저장된 op를 접어 현재 문서를 만든다.
     *
     * <p><b>마지막 스냅샷부터 접는다.</b> 세션 전체를 접으면 강의가 길어질수록 느려진다. 스냅샷은
     * 그 자체로 전체 상태라 그 이전 op는 볼 필요가 없다.
     *
     * @return 복원된 문서. 저장된 op가 없으면 revision 0의 빈 문서.
     */
    @Transactional(readOnly = true)
    public AnnotationDocumentView restore(UUID sessionId) {
        /*
         * 시작점 후보가 둘이다(ADR-0057).
         *
         *   체크포인트 테이블 — 지금 쓰는 경로. 강사 클라이언트가 주기적으로 저장한다.
         *   snapshot op     — 옛 세션에 남아 있을 수 있고, ADR-0055의 안전망(저장이 밀리면 강사가
         *                     스냅샷을 민다)도 여전히 이 경로를 쓴다.
         *
         * 둘 중 <b>더 최근 것</b>에서 시작한다. 하나만 보면 다른 쪽이 더 앞서 있을 때 그만큼을
         * 헛되이 다시 접는다.
         */
        Optional<LiveAnnotationOp> snapshotOp =
                repository.findFirstBySessionIdAndOpTypeOrderByRevisionDesc(sessionId, SNAPSHOT);
        Optional<LiveAnnotationSnapshot> checkpoint = snapshotRepository.findById(sessionId);

        long opRevision = snapshotOp.map(LiveAnnotationOp::getRevision).orElse(0L);
        long checkpointRevision = checkpoint.map(LiveAnnotationSnapshot::getRevision).orElse(0L);

        long from;
        String payload;
        if (checkpoint.isPresent() && checkpointRevision >= opRevision) {
            from = checkpointRevision;
            payload = checkpoint.get().getPayload();
        } else {
            from = opRevision;
            payload = snapshotOp.map(LiveAnnotationOp::getPayload).orElse(null);
        }

        List<LiveAnnotationOp> after =
                repository.findBySessionIdAndRevisionGreaterThanOrderByRevisionAsc(sessionId, from);

        long revision = after.isEmpty() ? from : after.get(after.size() - 1).getRevision();
        return new AnnotationDocumentView(
                revision,
                payload,
                after.stream().map(op -> new OpView(op.getRevision(), op.getOpType(), op.getPayload())).toList());
    }

    /**
     * 강사가 이어서 채번할 시작점.
     *
     * <p>강사가 새로고침하면 카운터가 0으로 돌아가는데, Egress의 문서 revision은 살아 있다. 그대로
     * 두면 새로 그린 획이 전부 "이미 본 op"로 버려져 <b>수강생에게 영영 나타나지 않는다</b>. 이 값을
     * 받아 이어가면 그런 역행이 생기지 않는다.
     */
    @Transactional(readOnly = true)
    public long nextRevision(UUID sessionId) {
        return repository.findMaxRevision(sessionId) + 1;
    }

    /** 저장이 실패해도 강의는 계속되어야 한다. 호출자가 이 메서드로 감싸 예외를 삼킨다. */
    public void appendQuietly(UUID sessionId, long revision, String opType, String payload, OffsetDateTime occurredAt) {
        try {
            append(sessionId, revision, opType, payload, occurredAt);
        } catch (RuntimeException e) {
            log.warn("판서 op 적재 실패(무시) session={} revision={}: {}", sessionId, revision, e.getMessage());
        }
    }

    /** 복원 결과. 마지막 스냅샷 + 그 이후 op들. 접는 것은 FE가 한다(같은 로직이 이미 그쪽에 있다). */
    public record AnnotationDocumentView(long revision, String snapshotPayload, List<OpView> ops) {
    }

    public record OpView(long revision, String opType, String payload) {
    }
}
