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
    private final LiveInteractionGuard interactionGuard;

    public LiveAccessGuard(LiveSessionRepository liveSessionRepository,
                           EnrollmentDirectory enrollmentDirectory,
                           LiveInteractionGuard interactionGuard) {
        this.liveSessionRepository = liveSessionRepository;
        this.enrollmentDirectory = enrollmentDirectory;
        this.interactionGuard = interactionGuard;
    }

    /**
     * 접근 허용: 세션 소유 강사이거나, 소속 커리큘럼의 ACTIVE 수강생. 아니면 403(Forbidden).
     *
     * @return 요청자가 <b>소유 강사</b>인가. 통과한 사람이 강사인지 수강생인지 호출자가 다시 조회하지
     *         않도록 돌려준다(접속자 집계가 강사를 빼는 데 쓴다). 필요 없으면 무시하면 된다.
     */
    @Transactional(readOnly = true)
    public boolean requireCanAccess(UUID sessionId, UUID userId) {
        return checkAccess(load(sessionId), userId);
    }

    /**
     * 강의 <b>내용</b> 읽기 허용: 접근 게이트에 더해, 수강생은 <b>시작한 적 있는 세션만</b>.
     *
     * <p>자막·강의 노트·채팅 기록·판서는 모두 강의가 시작된 뒤에 생긴다. 시작 전에 물으면 지금은 빈 값이
     * 돌아오는데, 그러면 "아직 없다"와 "정말 하나도 없었다"가 같은 응답이 된다 — 화면은 기다리라고 말하는데
     * 서버는 다 줬다고 답하는 셈이다. 상태를 아는 쪽이 서버이므로 서버가 말한다(ADR-0084).
     *
     * <p><b>소유 강사는 상태와 무관하게 통과시킨다.</b> 자기 세션에서 감출 것이 없고, 새로고침 뒤 자기
     * 판서를 복원하는 길이 이것이다 — 상태로 막으면 방금 그린 것을 못 되찾는다.
     *
     * <p>이 게이트는 <b>세션 쿠키로 오는 사람</b>에게만 쓴다. 두 곳이 일부러 빠져 있다:
     * <ul>
     *   <li>Egress(헤드리스 Chrome)는 LiveKit 토큰으로 판서를 가져가고 그 시점이 {@code STARTING}
     *       중이다(Gate A~C는 LIVE 전에 돈다). 여기로 묶으면 <b>녹화 시작이 막힌다</b>.</li>
     *   <li>세션 조회와 상태 토픽 구독. 시작을 기다리는 화면이 <b>바로 그 둘로 시작을 알아챈다</b> —
     *       막으면 기다리는 사람이 영원히 기다린다.</li>
     * </ul>
     *
     * @return {@link #requireCanAccess}와 같다 — 요청자가 소유 강사인가.
     */
    @Transactional(readOnly = true)
    public boolean requireCanReadContent(UUID sessionId, UUID userId) {
        LiveSession session = load(sessionId);
        boolean owner = checkAccess(session, userId);
        if (!owner && !interactionGuard.hasStarted(session)) {
            throw new LiveSessionStateConflictException("아직 시작하지 않은 강의입니다.");
        }
        return owner;
    }

    /**
     * 쓰기 허용: <b>세션 소유 강사만</b>. 수강생은 읽을 수 있어도 쓸 수 없다.
     *
     * <p>판서(ADR-0051)가 이 게이트를 쓴다. 판서의 writer는 강사 하나라는 전제 위에 revision 채번이
     * 서 있어서, 수강생이 쓸 수 있으면 번호가 충돌하고 수신 측의 유실 감지가 무의미해진다.
     */
    @Transactional(readOnly = true)
    public void requireOwner(UUID sessionId, UUID userId) {
        if (!userId.equals(load(sessionId).getInstructorId())) {
            throw new LiveSessionForbiddenException("이 라이브의 강사만 할 수 있습니다.");
        }
    }

    private LiveSession load(UUID sessionId) {
        return liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
    }

    /** @return 소유 강사인가. 강사도 활성 수강생도 아니면 403. */
    private boolean checkAccess(LiveSession session, UUID userId) {
        if (userId.equals(session.getInstructorId())) {
            return true;   // 세션을 만든 강사
        }
        if (enrollmentDirectory.isActive(session.getCurriculumId(), userId)) {
            return false;   // 활성 수강생
        }
        throw new LiveSessionForbiddenException("이 라이브에 접근 권한이 없습니다. 수강 신청·승인이 필요합니다.");
    }
}
