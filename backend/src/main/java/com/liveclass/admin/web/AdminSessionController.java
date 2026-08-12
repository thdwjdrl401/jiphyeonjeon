package com.liveclass.admin.web;

import com.liveclass.admin.service.SessionDetailService;
import com.liveclass.admin.service.SessionLabelService;
import com.liveclass.admin.service.SessionViewerService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 운영 콘솔의 세션 이름표.
 *
 * <p>콘솔은 갇힌 세션과 진행 중 Egress를 UUID로만 보여 줬다. 어느 강의인지 모르면 강제 정지를
 * 누를지 말지 판단할 수 없다. 화면이 표를 그리면서 필요한 id를 모아 한 번에 물어본다.
 *
 * <p><b>기존 관리 endpoint의 응답을 넓히지 않았다.</b> {@code /api/admin/live/summary}와
 * {@code /api/admin/egress}는 각자 다른 것(상태 집계·LiveKit 실시간 목록)을 보고 있고, 거기에
 * 이름표를 얹으면 두 응답이 같은 조회를 각자 하게 된다. 이름표는 별도 조회로 두고 화면이 붙인다.
 *
 * <p><b>조회지만 POST다.</b> 세션 id 여러 개를 쿼리스트링에 늘어놓으면 URL 길이 상한에 걸리고
 * 접근 로그가 id로 뒤덮인다.
 *
 * <p>권한은 {@code /api/admin/**}(ROLE_ADMIN)이 건다(SecurityConfig). <b>여기서 도메인 게이트를
 * 우회하지 않는다</b> — 돌려주는 것은 제목과 id뿐이고, 화면이 거는 링크도 공개 커리큘럼 페이지다.
 */
@Tag(name = "운영 콘솔", description = "운영자가 화면에서 판단하는 데 필요한 조합 조회.")
@RestController
public class AdminSessionController {

    /** 콘솔 표 한 화면 분량. 넘겨받은 만큼 조회하므로 상한을 둔다. */
    private static final int MAX_IDS = 200;

    private final SessionLabelService sessionLabelService;
    private final SessionDetailService sessionDetailService;
    private final SessionViewerService sessionViewerService;

    public AdminSessionController(SessionLabelService sessionLabelService,
                                  SessionDetailService sessionDetailService,
                                  SessionViewerService sessionViewerService) {
        this.sessionLabelService = sessionLabelService;
        this.sessionDetailService = sessionDetailService;
        this.sessionViewerService = sessionViewerService;
    }

    @Operation(summary = "세션 이름표 일괄 조회",
            description = "세션 id 목록을 주면 강의·커리큘럼 제목을 돌려준다. 못 찾은 id도 빈 값으로 함께 온다.")
    @PostMapping("/api/admin/session-labels")
    public List<SessionLabelService.SessionLabel> labels(@Valid @RequestBody LabelsRequest request) {
        return sessionLabelService.labelsFor(request.sessionIds());
    }

    /**
     * 세션 하나의 운영 상세. <b>읽기 전용</b>이고 여기서 도메인 게이트를 우회하지 않는다 —
     * 강사 화면을 열어 주는 대신 필요한 값만 모아 보여 준다(ADR-0089).
     *
     * <p>없는 세션은 <b>404</b>다. 목록의 이름표와 규칙이 다른 이유는 쓰임이 다르기 때문이다 —
     * 목록은 행을 짝지어야 해서 빈 값으로 채우지만, 상세는 주소로 직접 들어오는 화면이라 "그런
     * 세션 없음"을 분명히 말해야 한다.
     */
    @Operation(summary = "세션 운영 상세", description = "세션·강의·커리큘럼·강사·녹화 상태를 한 번에. 읽기 전용.")
    @GetMapping("/api/admin/live-sessions/{sessionId}")
    public SessionDetailService.SessionDetail detail(@PathVariable UUID sessionId) {
        return sessionDetailService.findBySessionId(sessionId)
                .orElseThrow(() -> new SessionNotFoundException(sessionId));
    }

    /**
     * 이 세션을 <b>지금 누가 보고 있는가</b>(ADR-0121). 읽기 전용이고 상세와 같은 게이트 위에 있다.
     *
     * <p>상세와 나눈 이유는 <b>수명이 다르기 때문</b>이다. 세션 상세는 거의 변하지 않지만 접속자는
     * 초 단위로 바뀌어 화면이 짧게 폴링한다. 한 응답에 묶으면 접속자를 새로 받으려고 강의 제목·녹화
     * 상태까지 매번 다시 조회하게 된다.
     *
     * <p>없는 세션은 <b>404</b>다(상세와 같은 규칙).
     */
    @Operation(summary = "세션 시청자 현황",
            description = "라이브 강의실 접속자와 최근 다시보기 시청자를 한 번에. 조회 시점의 현황이라 매번 달라진다.")
    @GetMapping("/api/admin/live-sessions/{sessionId}/viewers")
    public SessionViewerService.SessionViewers viewers(@PathVariable UUID sessionId) {
        return sessionViewerService.findBySessionId(sessionId)
                .orElseThrow(() -> new SessionNotFoundException(sessionId));
    }

    public record LabelsRequest(
            @NotEmpty @Size(max = MAX_IDS) List<UUID> sessionIds) {
    }

    /** 없는 세션. 운영 콘솔 전용이라 이 모듈 안에서 404로 매핑한다. */
    @ResponseStatus(HttpStatus.NOT_FOUND)
    static class SessionNotFoundException extends RuntimeException {
        SessionNotFoundException(UUID sessionId) {
            super("세션을 찾을 수 없습니다: " + sessionId);
        }
    }
}
