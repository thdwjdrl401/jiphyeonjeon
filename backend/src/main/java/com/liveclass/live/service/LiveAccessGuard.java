package com.liveclass.live.service;

import com.liveclass.enrollment.api.EnrollmentDirectory;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.repository.LiveSessionRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * 라이브 세션 접근 게이트. 세션에 비정규화된 curriculumId로 수강 여부를 확인한다 —
 * session → enrollment.isActive를 사이클(live→curriculum) 없이. 세션 조회·채팅이 이걸 통과해야 한다.
 */
@Component
public class LiveAccessGuard {

    private final LiveSessionRepository liveSessionRepository;
    private final EnrollmentDirectory enrollmentDirectory;

    public LiveAccessGuard(LiveSessionRepository liveSessionRepository, EnrollmentDirectory enrollmentDirectory) {
        this.liveSessionRepository = liveSessionRepository;
        this.enrollmentDirectory = enrollmentDirectory;
    }

    /** 접근 허용: 세션 소유 강사이거나, 소속 커리큘럼의 ACTIVE 수강생. 아니면 403(Forbidden). */
    @Transactional(readOnly = true)
    public void requireCanAccess(UUID sessionId, UUID userId) {
        LiveSession session = liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        if (userId.equals(session.getInstructorId())) {
            return;   // 세션을 만든 강사
        }
        if (enrollmentDirectory.isActive(session.getCurriculumId(), userId)) {
            return;   // 활성 수강생
        }
        throw new LiveSessionForbiddenException("이 라이브에 접근 권한이 없습니다. 수강 신청·승인이 필요합니다.");
    }
}
