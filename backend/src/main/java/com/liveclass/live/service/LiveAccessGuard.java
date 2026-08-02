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

    /**
     * 접근 허용: 세션 소유 강사이거나, 소속 커리큘럼의 ACTIVE 수강생. 아니면 403(Forbidden).
     *
     * @return 요청자가 <b>소유 강사</b>인가. 통과한 사람이 강사인지 수강생인지 호출자가 다시 조회하지
     *         않도록 돌려준다(접속자 집계가 강사를 빼는 데 쓴다). 필요 없으면 무시하면 된다.
     */
    @Transactional(readOnly = true)
    public boolean requireCanAccess(UUID sessionId, UUID userId) {
        LiveSession session = liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        if (userId.equals(session.getInstructorId())) {
            return true;   // 세션을 만든 강사
        }
        if (enrollmentDirectory.isActive(session.getCurriculumId(), userId)) {
            return false;   // 활성 수강생
        }
        throw new LiveSessionForbiddenException("이 라이브에 접근 권한이 없습니다. 수강 신청·승인이 필요합니다.");
    }

    /**
     * 쓰기 허용: <b>세션 소유 강사만</b>. 수강생은 읽을 수 있어도 쓸 수 없다.
     *
     * <p>판서(ADR-0051)가 이 게이트를 쓴다. 판서의 writer는 강사 하나라는 전제 위에 revision 채번이
     * 서 있어서, 수강생이 쓸 수 있으면 번호가 충돌하고 수신 측의 유실 감지가 무의미해진다.
     */
    @Transactional(readOnly = true)
    public void requireOwner(UUID sessionId, UUID userId) {
        LiveSession session = liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        if (!userId.equals(session.getInstructorId())) {
            throw new LiveSessionForbiddenException("이 라이브의 강사만 할 수 있습니다.");
        }
    }
}
