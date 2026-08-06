package com.liveclass.video.web;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.video.service.EgressControl;
import com.liveclass.video.service.EgressControlException;
import com.liveclass.video.service.EgressOrphanPurge;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Egress 운영 콘솔용 관리 endpoint. 서버 전체의 진행 중 Egress를 나열하고 강제로 정지한다 —
 * "유령 Egress"(끝난 방에 남아 전역 1-슬롯을 잡아먹는 것)를 사람이 즉시 걷어내기 위한 도구다.
 *
 * <p>정지의 정본 경로는 여전히 {@code LiveSessionEndedEvent → stopRecording}(이벤트 기반 best-effort)이고,
 * 이 콘솔은 그게 실패했을 때의 수동 회수 수단이다. 근본 해결(전역 orphan reconciler)은 후속이다.
 *
 * <p><b>이 콘솔로도 걷을 수 없는 유령이 있다.</b> Egress 작업은 그것을 시작한 핸들러 <b>프로세스</b>가
 * 소유하는데, 녹화 도중 egress 컨테이너가 재시작되면 그 프로세스가 완료 보고 없이 사라진다. LiveKit은
 * 작업을 계속 진행 중으로 들고 있지만 {@code StopEgress} RPC를 받아 줄 상대가 없고, 고아를 회수하는
 * API도 없어 사람이 LiveKit Redis에서 직접 지워야 한다(2026-08-05에 두 호스트에서 각각 한 건 생겼다).
 * 그런 건은 {@code ORPHANED}로 내려 콘솔이 "다시 눌러도 같다"고 말하게 한다.
 *
 * <p>권한은 {@code /api/admin/**}(ROLE_ADMIN)로 게이팅된다(SecurityConfig). ADMIN은 별도 회원가입 역할이
 * 아니라 {@code security.admin-emails}에 든 계정에 로그인 시 오버레이되는 권한이다({@code AdminAccounts}).
 */
@RestController
@RequestMapping("/api/admin/egress")
public class EgressAdminController {

    private static final Logger log = LoggerFactory.getLogger(EgressAdminController.class);

    private final EgressControl egressControl;
    private final EgressOrphanPurge orphanPurge;

    public EgressAdminController(EgressControl egressControl, EgressOrphanPurge orphanPurge) {
        this.egressControl = egressControl;
        this.orphanPurge = orphanPurge;
    }

    /** 진행 중(STARTING/ACTIVE) Egress 전체 목록. */
    @GetMapping
    public List<EgressControl.ActiveEgress> listActive() {
        return egressControl.listActive();
    }

    /**
     * 지정 Egress 강제 정지. <b>결말을 200 본문으로 돌려준다</b> — 오류로 올리지 않는다.
     *
     * <p>전에는 204만 돌려주고 정지가 안 되는 경우를 전부 502로 던졌다. 그런데 그 안에는
     * "이미 끝나서 할 일이 없음"과 "소유 노드가 사라져 영영 안 됨"이 섞여 있어, 콘솔은 둘 다
     * "정지에 실패했습니다"로만 보여 줬다. 앞의 것은 멀쩡한 조작에 빨간불을 띄우는 것이고,
     * 뒤의 것은 무엇을 해야 하는지 알려 주지 않는다. 결말을 값으로 내려 콘솔이 구분해 말하게 한다.
     */
    @PostMapping("/{egressId}/stop")
    public StopResponse stop(@PathVariable String egressId) {
        log.info("관리 콘솔 Egress 강제 정지 요청 egressId={}", egressId);
        EgressControl.StopOutcome outcome = egressControl.stopRecording(egressId);
        log.info("관리 콘솔 Egress 정지 결말 egressId={} outcome={}", egressId, outcome);
        return new StopResponse(outcome);
    }

    /** 정지 결말 응답. {@code STOPPED} / {@code ALREADY_ENDED} / {@code ORPHANED}. */
    public record StopResponse(EgressControl.StopOutcome outcome) {
    }

    /**
     * 유령 Egress 회수 — LiveKit이 정지시킬 수 없는 기록을 걷어낸다.
     *
     * <p><b>먼저 유령임을 확인하고 지운다.</b> 정지가 되는 작업이면 그것은 유령이 아니므로 회수 대상이
     * 아니다(그리고 이 호출로 실제 정지가 일어났으니 콘솔이 목록을 새로 받으면 사라진다). 살아 있는
     * 녹화의 기록을 지우면 그 녹화는 완료 보고할 곳을 잃기 때문에, 확인 없이는 진행하지 않는다.
     *
     * <p>중계도 지우기 직전에 같은 확인을 한 번 더 한다 — 여기서 통과해도 그쪽에서 막힐 수 있다.
     * 위험한 조작의 판단을 한 곳에만 두지 않는다.
     */
    @PostMapping("/{egressId}/purge")
    public PurgeResponse purge(@PathVariable String egressId) {
        log.info("관리 콘솔 유령 Egress 회수 요청 egressId={}", egressId);
        if (!orphanPurge.isAvailable()) {
            throw new EgressControlException("이 배포에는 회수 중계가 설정되어 있지 않다 "
                    + "(liveclass.egress.purger.base-url / .secret)");
        }
        EgressControl.StopOutcome outcome = egressControl.stopRecording(egressId);
        if (outcome != EgressControl.StopOutcome.ORPHANED) {
            log.info("유령이 아니어서 회수하지 않음 egressId={} outcome={}", egressId, outcome);
            return new PurgeResponse(false, outcome);
        }
        orphanPurge.purgeOrphan(egressId);
        return new PurgeResponse(true, outcome);
    }

    /**
     * 회수 결과.
     *
     * @param purged  실제로 기록을 지웠는가
     * @param outcome 지우기 전에 확인한 정지 결말 — 지우지 않았다면 그 이유가 여기 있다
     */
    public record PurgeResponse(boolean purged, EgressControl.StopOutcome outcome) {
    }

    /** LiveKit 통신/제어 실패는 502로 — 서버 버그가 아니라 업스트림(LiveKit) 문제임을 알린다. */
    @ExceptionHandler(EgressControlException.class)
    public ResponseEntity<ErrorResponse> handleControl(EgressControlException e) {
        log.warn("Egress 관리 조작 실패: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(ErrorResponse.of("EGRESS_CONTROL_FAILED", e.getMessage()));
    }
}
