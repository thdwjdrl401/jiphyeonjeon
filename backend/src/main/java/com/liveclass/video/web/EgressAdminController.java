package com.liveclass.video.web;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.video.service.EgressControl;
import com.liveclass.video.service.EgressControlException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Egress 운영 콘솔용 관리 endpoint. 서버 전체의 진행 중 Egress를 나열하고 강제로 정지한다 —
 * "유령 Egress"(끝난 방에 남아 전역 1-슬롯을 잡아먹는 것)를 사람이 즉시 걷어내기 위한 도구다.
 *
 * <p>정지의 정본 경로는 여전히 {@code LiveSessionEndedEvent → stopRecording}(이벤트 기반 best-effort)이고,
 * 이 콘솔은 그게 실패했을 때의 수동 회수 수단이다. 근본 해결(전역 orphan reconciler)은 후속이다.
 *
 * <p>권한은 {@code /api/admin/**}(ROLE_ADMIN)로 게이팅된다(SecurityConfig). ADMIN은 별도 회원가입 역할이
 * 아니라 {@code security.admin-emails}에 든 계정에 로그인 시 오버레이되는 권한이다({@code AdminAccounts}).
 */
@RestController
@RequestMapping("/api/admin/egress")
public class EgressAdminController {

    private static final Logger log = LoggerFactory.getLogger(EgressAdminController.class);

    private final EgressControl egressControl;

    public EgressAdminController(EgressControl egressControl) {
        this.egressControl = egressControl;
    }

    /** 진행 중(STARTING/ACTIVE) Egress 전체 목록. */
    @GetMapping
    public List<EgressControl.ActiveEgress> listActive() {
        return egressControl.listActive();
    }

    /** 지정 Egress 강제 정지(멱등 — 이미 없으면 성공). */
    @PostMapping("/{egressId}/stop")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void stop(@PathVariable String egressId) {
        log.info("관리 콘솔 Egress 강제 정지 요청 egressId={}", egressId);
        egressControl.stopRecording(egressId);
    }

    /** LiveKit 통신/제어 실패는 502로 — 서버 버그가 아니라 업스트림(LiveKit) 문제임을 알린다. */
    @ExceptionHandler(EgressControlException.class)
    public ResponseEntity<ErrorResponse> handleControl(EgressControlException e) {
        log.warn("Egress 관리 조작 실패: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(ErrorResponse.of("EGRESS_CONTROL_FAILED", e.getMessage()));
    }
}
