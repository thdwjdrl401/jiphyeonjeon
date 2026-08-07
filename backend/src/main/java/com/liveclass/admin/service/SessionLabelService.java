package com.liveclass.admin.service;

import com.liveclass.curriculum.api.CurriculumDirectory;
import com.liveclass.curriculum.api.CurriculumView;
import com.liveclass.lesson.api.LessonDirectory;
import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionView;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 세션 id를 <b>사람이 읽는 이름</b>으로 바꾼다.
 *
 * <p>운영 콘솔은 갇힌 세션과 진행 중 Egress를 UUID로만 보여 줬다. 운영자가 그것을 보고 할 수 있는
 * 판단은 없다 — 강제로 정지시킬지 말지는 <b>어느 강의인가</b>에 달려 있는데 화면에 그게 없었다.
 *
 * <p><b>한 번에 여러 개를 받는다.</b> 콘솔은 표를 그리므로 행마다 왕복하면 행 수만큼 요청이 나간다.
 * 강의 제목은 이미 배치 조회가 있고({@code LessonDirectory.findTitles}), 커리큘럼은 세션 여럿이
 * 같은 것을 가리키는 일이 많아 중복을 걷어내고 한 번씩만 읽는다.
 *
 * <p><b>못 찾은 것은 비워서 돌려준다.</b> 세션이 지워졌거나 강의가 삭제된 경우가 실제로 있고
 * (유령 Egress가 정확히 그런 상황이다), 그때 404를 내면 <b>나머지 행의 이름표까지 사라진다</b> —
 * 운영 화면이 한 건 때문에 통째로 쓸모없어지면 안 된다.
 */
@Service
public class SessionLabelService {

    private final LiveSessionDirectory liveSessionDirectory;
    private final LessonDirectory lessonDirectory;
    private final CurriculumDirectory curriculumDirectory;

    public SessionLabelService(LiveSessionDirectory liveSessionDirectory,
                               LessonDirectory lessonDirectory,
                               CurriculumDirectory curriculumDirectory) {
        this.liveSessionDirectory = liveSessionDirectory;
        this.lessonDirectory = lessonDirectory;
        this.curriculumDirectory = curriculumDirectory;
    }

    @Transactional(readOnly = true)
    public List<SessionLabel> labelsFor(Collection<UUID> sessionIds) {
        if (sessionIds == null || sessionIds.isEmpty()) {
            return List.of();
        }
        // 요청 순서를 유지하고 중복은 한 번만 조회한다 — 같은 세션이 두 패널에 함께 뜰 수 있다.
        List<UUID> distinct = sessionIds.stream()
                .filter(Objects::nonNull)
                .distinct()
                .toList();

        Map<UUID, LiveSessionView> sessions = new LinkedHashMap<>();
        for (UUID sessionId : distinct) {
            liveSessionDirectory.findById(sessionId).ifPresent(view -> sessions.put(sessionId, view));
        }

        Map<UUID, String> lessonTitles = lessonDirectory.findTitles(
                sessions.values().stream().map(LiveSessionView::lessonId)
                        .filter(Objects::nonNull).distinct().toList());

        Map<UUID, CurriculumView> curriculums = new LinkedHashMap<>();
        for (UUID sessionId : sessions.keySet()) {
            liveSessionDirectory.findCurriculumId(sessionId)
                    .filter(id -> !curriculums.containsKey(id))
                    .flatMap(curriculumDirectory::findById)
                    .ifPresent(view -> curriculums.put(view.curriculumId(), view));
        }

        List<SessionLabel> labels = new ArrayList<>(distinct.size());
        for (UUID sessionId : distinct) {
            LiveSessionView session = sessions.get(sessionId);
            if (session == null) {
                // 세션이 사라졌다. 유령 Egress가 이 경우다 — 행을 빼지 않고 "모름"으로 남긴다.
                labels.add(new SessionLabel(sessionId, null, null, null, null));
                continue;
            }
            Optional<CurriculumView> curriculum = liveSessionDirectory.findCurriculumId(sessionId)
                    .map(curriculums::get);
            labels.add(new SessionLabel(
                    sessionId,
                    session.lessonId(),
                    session.lessonId() == null ? null : lessonTitles.get(session.lessonId()),
                    curriculum.map(CurriculumView::curriculumId).orElse(null),
                    curriculum.map(CurriculumView::title).orElse(null)));
        }
        return labels;
    }

    /**
     * @param sessionId       물어본 세션 id. 못 찾아도 이 값은 채워 돌려준다 — 화면이 행을 짝지어야 한다.
     * @param lessonId        강의 id. 세션을 못 찾았으면 {@code null}
     * @param lessonTitle     강의 제목. 강의가 지워졌으면 {@code null}
     * @param curriculumId    커리큘럼 id. 화면이 공개 커리큘럼 페이지로 링크하는 데 쓴다
     * @param curriculumTitle 커리큘럼 제목
     */
    public record SessionLabel(
            UUID sessionId,
            UUID lessonId,
            String lessonTitle,
            UUID curriculumId,
            String curriculumTitle) {
    }
}
