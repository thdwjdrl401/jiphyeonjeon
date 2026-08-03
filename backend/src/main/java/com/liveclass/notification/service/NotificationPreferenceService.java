package com.liveclass.notification.service;

import com.liveclass.notification.api.NotificationLeadTimes;
import com.liveclass.notification.domain.NotificationPreference;
import com.liveclass.notification.repository.NotificationPreferenceRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * 곧 시작 알림 설정(ADR-0073 4단계).
 *
 * <p>우선순위는 <b>강의 → 커리큘럼 → 기본값</b>이다. 끄기도 덮어쓰기의 일부라 같은 순서를 따른다 —
 * 커리큘럼을 꺼 두고 특정 강의만 켤 수 있다.
 *
 * <p>발화 판정은 여기서 하지 않는다. 팬아웃 SQL이 같은 규칙을 조인으로 건다 — 수강생 수만큼
 * 이 메서드를 부르면 그 수만큼 왕복이 생기기 때문이다. 여기는 <b>화면이 지금 값을 보여 줄 때</b> 쓴다.
 */
@Service
public class NotificationPreferenceService {

    private final NotificationPreferenceRepository repository;

    public NotificationPreferenceService(NotificationPreferenceRepository repository) {
        this.repository = repository;
    }

    /** 지금 이 강의에 적용되는 값. 강의 설정이 없으면 커리큘럼, 그것도 없으면 기본값이다. */
    @Transactional(readOnly = true)
    public Effective effective(UUID userId, UUID curriculumId, UUID lessonId) {
        if (lessonId != null) {
            var lesson = repository.findByUserIdAndLessonId(userId, lessonId);
            if (lesson.isPresent()) {
                return Effective.of(lesson.get(), "LESSON");
            }
        }
        return repository.findByUserIdAndCurriculumIdAndLessonIdIsNull(userId, curriculumId)
                .map(p -> Effective.of(p, "CURRICULUM"))
                .orElseGet(() -> new Effective(true, NotificationLeadTimes.DEFAULT_MINUTES, "DEFAULT"));
    }

    @Transactional(readOnly = true)
    public List<NotificationPreference> mine(UUID userId, UUID curriculumId) {
        return repository.findByUserIdAndCurriculumId(userId, curriculumId);
    }

    /**
     * 저장. 같은 대상의 설정이 이미 있으면 갱신한다.
     *
     * @param lessonId null이면 커리큘럼 전체 설정
     * @throws IllegalArgumentException 선택지에 없는 리드타임. 자유 입력을 허용하면 예약 표가
     *                                  그 값을 알 수 없어 그 사람에게는 알림이 영영 가지 않는다.
     */
    @Transactional
    public void save(UUID userId, UUID curriculumId, UUID lessonId, boolean enabled, int leadMinutes) {
        if (!NotificationLeadTimes.isAllowed(leadMinutes)) {
            throw new IllegalArgumentException("허용되지 않은 리드타임입니다: " + leadMinutes);
        }
        NotificationPreference preference = (lessonId == null
                ? repository.findByUserIdAndCurriculumIdAndLessonIdIsNull(userId, curriculumId)
                : repository.findByUserIdAndLessonId(userId, lessonId))
                .orElseGet(NotificationPreference::new);
        preference.setUserId(userId);
        preference.setCurriculumId(curriculumId);
        preference.setLessonId(lessonId);
        preference.setEnabled(enabled);
        preference.setLeadMinutes(leadMinutes);
        repository.save(preference);
    }

    /**
     * 지금 적용되는 값과 <b>어디서 왔는지</b>.
     *
     * @param source LESSON·CURRICULUM·DEFAULT. 화면이 "이 강의만 다르게 설정됨"을 표시하는 데 쓴다 —
     *               값만 주면 사용자는 자기가 어디를 고쳤는지 알 수 없다.
     */
    public record Effective(boolean enabled, int leadMinutes, String source) {

        static Effective of(NotificationPreference preference, String source) {
            return new Effective(preference.isEnabled(),
                    preference.getLeadMinutes() == null
                            ? NotificationLeadTimes.DEFAULT_MINUTES : preference.getLeadMinutes(),
                    source);
        }
    }
}
