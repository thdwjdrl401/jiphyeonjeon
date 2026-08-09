package com.liveclass.learning.service;

import com.liveclass.learning.api.LessonGlossaryChangedEvent;
import com.liveclass.learning.api.LessonLearningAccess;
import com.liveclass.learning.domain.LessonGlossaryOverride;
import com.liveclass.learning.repository.LessonGlossaryOverrideRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 강의 용어집. <b>두 겹을 읽을 때 합친다.</b>
 *
 * <ul>
 *   <li>베이스 — {@code ai.material_key_term}(AI가 PPTX에서 뽑은 것, ai-worker 소유)</li>
 *   <li>덮어쓰기 — {@code core.lesson_glossary_override}(강사가 고치거나 더한 것)</li>
 * </ul>
 *
 * <p><b>복사하지 않는다.</b> 복사하면 두 벌이 갈라지고, AI가 다시 추출했을 때 어느 쪽이 최신인지
 * 알 수 없게 된다. 같은 DB의 다른 스키마라 읽기만 하면 된다.
 *
 * <p><b>자막 매핑은 서버가 하지 않는다.</b> 자막은 WebSocket으로 실시간으로 도착하고 화면은 용어집을
 * 이미 들고 있으므로, 도착한 줄에서 찾는 편이 짧다. 서버가 하면 자막마다 왕복이 생기고 강사가 용어를
 * 고쳤을 때 이미 그려진 자막을 다시 계산해야 한다.
 */
@Service
public class LessonGlossaryService {

    private static final Logger log = LoggerFactory.getLogger(LessonGlossaryService.class);

    private final LessonGlossaryOverrideRepository repository;
    private final LessonLearningAccess access;
    private final ApplicationEventPublisher events;

    public LessonGlossaryService(LessonGlossaryOverrideRepository repository, LessonLearningAccess access,
                                 ApplicationEventPublisher events) {
        this.repository = repository;
        this.access = access;
        this.events = events;
    }

    /**
     * 최종 용어집. 같은 용어가 양쪽에 있으면 강사 수정본이 이기고, 강사 쪽에만 있으면 추가된 용어다.
     *
     * <p>학습 게이트가 아니라 집계 게이트를 쓴다 — 강사도 자기 강의의 용어집을 봐야 한다.
     *
     * <p><b>하나의 트랜잭션으로 묶지 않는다.</b> ai 원본 조회가 실패하면(스키마 없음 등) 그 트랜잭션이
     * 롤백 전용으로 표시돼, 예외를 잡아도 커밋에서 다시 터진다 — 강사 수정본까지 못 읽게 된다.
     * 두 조회를 각자의 트랜잭션에서 하면 한쪽 실패가 다른 쪽을 막지 않는다.
     */
    public List<GlossaryTerm> glossary(UUID userId, UUID lessonId) {
        access.ensureCanViewInsights(userId, lessonId);

        // 용어 이름을 키로 합친다. ai 쪽 PK는 자료 버전을 포함해 재업로드마다 바뀌지만 이름은 그대로다.
        Map<String, GlossaryTerm> merged = new LinkedHashMap<>();
        for (LessonGlossaryOverrideRepository.SourceTerm source : readSourceTerms(lessonId)) {
            merged.put(source.getTerm(), new GlossaryTerm(source.getTerm(), source.getDefinition(), "MATERIAL"));
        }
        for (LessonGlossaryOverride override : repository.findByLessonId(lessonId)) {
            merged.put(override.getTerm(), new GlossaryTerm(override.getTerm(), override.getDefinition(), "INSTRUCTOR"));
        }
        return new ArrayList<>(merged.values());
    }

    /**
     * ai 원본을 읽는다. <b>없어도 실패하지 않는다.</b>
     *
     * <p>{@code ai} 스키마는 ai-worker의 마이그레이션이 만든다 — 로컬·테스트처럼 AI 스택 없이 도는
     * 환경에는 그 표가 없다. 그때 용어집 전체가 500이 되면 강사 수정본까지 못 읽는다. 원본이 없으면
     * 강사가 넣은 것만 보여주는 편이 맞다.
     */
    private List<LessonGlossaryOverrideRepository.SourceTerm> readSourceTerms(UUID lessonId) {
        if (!repository.sourceTableExists()) {
            log.debug("ai 용어 원본 표가 없다 — 강사 수정본만 쓴다");
            return List.of();
        }
        return repository.findSourceTerms(lessonId);
    }

    /** 강사가 용어를 고치거나 더한다. 같은 용어를 다시 쓰면 덮어쓴다(멱등). */
    @Transactional
    public GlossaryTerm upsert(UUID instructorId, UUID lessonId, String term, String definition) {
        access.ensureCanViewInsights(instructorId, lessonId);
        String trimmed = term.trim();
        LessonGlossaryOverride row = repository
                .findById(new com.liveclass.learning.domain.LessonGlossaryOverrideId(lessonId, trimmed))
                .orElseGet(() -> {
                    LessonGlossaryOverride created = new LessonGlossaryOverride();
                    created.setLessonId(lessonId);
                    created.setTerm(trimmed);
                    return created;
                });
        row.setDefinition(definition.trim());
        row.setUpdatedBy(instructorId);
        row.setUpdatedAt(OffsetDateTime.now());
        repository.save(row);
        // 진행 중인 라이브 화면이 용어집을 다시 읽게 한다. 라이브가 없으면 듣는 쪽이 조용히 흘린다.
        events.publishEvent(new LessonGlossaryChangedEvent(lessonId, LessonGlossaryChangedEvent.Reason.INSTRUCTOR_EDIT));
        return new GlossaryTerm(trimmed, row.getDefinition(), "INSTRUCTOR");
    }

    /**
     * @param source {@code MATERIAL}(AI가 자료에서 뽑음) 또는 {@code INSTRUCTOR}(강사가 고치거나 더함).
     *               화면이 "강사 등록" 같은 출처 배지를 붙이는 데 쓴다.
     */
    public record GlossaryTerm(String term, String definition, String source) {
    }
}
