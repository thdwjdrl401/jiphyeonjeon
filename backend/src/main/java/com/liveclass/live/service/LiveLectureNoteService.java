package com.liveclass.live.service;

import com.liveclass.live.api.LiveLectureNoteView;
import com.liveclass.live.domain.LiveLectureNote;
import com.liveclass.live.repository.LiveLectureNoteRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

/**
 * 라이브 강의 노트 read model의 소유자(CONTRACT §3-4a).
 *
 * <p><b>소비 방식과 분리돼 있다.</b> ai-api가 노트를 증분 조각으로 보내든 전체 스냅샷으로 보내든,
 * 소비자는 "현재 전체 노트"를 만들어 {@link #replace}로 넘기기만 한다. 그래서 발행 방식이 확정되기
 * 전에도 저장·조회·전파 경로를 먼저 세울 수 있다.
 */
@Service
public class LiveLectureNoteService {

    private static final Logger log = LoggerFactory.getLogger(LiveLectureNoteService.class);

    private final LiveLectureNoteRepository repository;

    public LiveLectureNoteService(LiveLectureNoteRepository repository) {
        this.repository = repository;
    }

    /** 새로고침·재연결 복구용 조회. 아직 노트가 없으면 빈 노트를 준다. */
    @Transactional(readOnly = true)
    public LiveLectureNoteView find(UUID sessionId) {
        return repository.findById(sessionId).map(LiveLectureNoteService::toView)
                .orElseGet(() -> LiveLectureNoteView.empty(sessionId));
    }

    /**
     * 현재 전체 노트로 교체한다.
     *
     * <p><b>뒤로 가지 않는다.</b> {@code coveredThroughSequence}가 지금 값보다 크지 않으면 무시한다 —
     * 재전송·순서 역전으로 옛 노트가 도착해도 최신 노트를 덮지 않게 하기 위해서다. 같은 값이 다시 와도
     * 무시하므로 재전송이 안전하다(멱등).
     *
     * @return 실제로 바뀌었으면 새 노트, 오래된 갱신이라 무시했으면 empty
     */
    @Transactional
    public Optional<LiveLectureNoteView> replace(UUID sessionId, UUID lessonId, long coveredThroughSequence,
                                                 String topics, String markdown, String status) {
        LiveLectureNote note = repository.findById(sessionId).orElseGet(() -> {
            LiveLectureNote created = new LiveLectureNote();
            created.setSessionId(sessionId);
            created.setCoveredThroughSequence(-1L);   // 첫 갱신(sequence 0)도 반영되게 한다
            return created;
        });
        if (note.getCoveredThroughSequence() >= coveredThroughSequence) {
            log.debug("오래된 강의 노트 갱신 무시 session={} 도착={} 현재={}",
                    sessionId, coveredThroughSequence, note.getCoveredThroughSequence());
            return Optional.empty();
        }
        note.setLessonId(lessonId);
        note.setCoveredThroughSequence(coveredThroughSequence);
        note.setTopics(topics);
        note.setMarkdown(markdown);
        note.setStatus(status);
        note.setUpdatedAt(OffsetDateTime.now());
        return Optional.of(toView(repository.save(note)));
    }

    static LiveLectureNoteView toView(LiveLectureNote note) {
        return new LiveLectureNoteView(
                note.getSessionId(),
                note.getCoveredThroughSequence(),
                note.getTopics() == null ? "[]" : note.getTopics(),
                note.getMarkdown() == null ? "" : note.getMarkdown(),
                note.getStatus(),
                note.getUpdatedAt());
    }
}
