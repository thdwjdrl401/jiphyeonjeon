package com.liveclass.live.web;

import com.liveclass.live.service.LiveAccessGuard;
import com.liveclass.live.service.LiveRoomTokenVerifier;
import com.liveclass.live.service.LiveAnnotationService;
import com.liveclass.live.web.dto.AnnotationDocumentResponse;
import com.liveclass.live.web.dto.AnnotationOpRequest;
import com.liveclass.live.web.dto.AnnotationVisibilityRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 판서 영속화(REST, 세션 기준) — ADR-0051, CONTRACT §3-6b.
 *
 * <p><b>라이브 전달 경로가 아니다.</b> 판서가 수강생에게 도달하는 경로는 LiveKit 데이터 채널
 * → Egress 합성 프레임이고, 이 API는 그와 병렬로 기록만 남긴다. 그래서 적재는 획을 그을 때마다가
 * 아니라 <b>묶어서</b> 오고, 응답을 기다려 화면을 갱신하지 않는다 — 저장을 라이브 경로에 넣으면
 * 그리는 동안의 부드러움이 깨진다.
 *
 * <p>얻는 것은 둘이다. 강사가 새로고침해도 판서가 남고, 각 op에 세션 상대 시각이 붙어 나중에
 * "강사가 이걸 강조한 순간"으로 다시보기를 이동할 수 있다(자막과 같은 축, ADR-0045).
 *
 * <p>인가는 세션 참가자 게이트({@link LiveAccessGuard})를 쓴다 — 자막·채팅과 같은 규칙이다. 다만
 * <b>쓰기는 소유 강사만</b> 한다. 판서의 writer는 강사 하나이고, 수강생이 쓸 수 있으면 revision 채번의
 * 단일 writer 전제가 깨진다.
 */
@Tag(name = "라이브 판서", description = "판서 op 적재·복원(REST). 실시간 전달은 LiveKit 데이터 채널로 별개.")
@RestController
public class AnnotationController {

    private final LiveAnnotationService annotationService;
    private final LiveAccessGuard accessGuard;
    private final LiveRoomTokenVerifier roomTokenVerifier;

    public AnnotationController(LiveAnnotationService annotationService,
                                LiveAccessGuard accessGuard,
                                LiveRoomTokenVerifier roomTokenVerifier) {
        this.annotationService = annotationService;
        this.accessGuard = accessGuard;
        this.roomTokenVerifier = roomTokenVerifier;
    }

    @Operation(summary = "판서 op 적재",
            description = "강사가 그린 변경을 기록한다. 라이브 전달과 별개이며 묶어서 보낸다. "
                    + "같은 revision이 다시 오면 중복 적재하지 않는다.")
    @PostMapping("/api/live-sessions/{sessionId}/annotation/ops")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void append(@PathVariable UUID sessionId,
                       @Valid @RequestBody List<AnnotationOpRequest> ops,
                       Authentication authentication) {
        accessGuard.requireOwner(sessionId, UUID.fromString(authentication.getName()));
        for (AnnotationOpRequest op : ops) {
            annotationService.append(sessionId, op.revision(), op.opType(), op.payload(), op.occurredAt());
        }
    }

    @Operation(summary = "판서 표시 상태 변경",
            description = "판서를 수강생 화면에 보여줄지 바꾼다. 내용이 아니라 표시 상태다(ADR-0056). "
                    + "강사가 새로고침해도 이 값으로 이전 상태가 돌아온다.")
    @PutMapping("/api/live-sessions/{sessionId}/annotation/visibility")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void setVisibility(@PathVariable UUID sessionId,
                              @Valid @RequestBody AnnotationVisibilityRequest request,
                              Authentication authentication) {
        accessGuard.requireOwner(sessionId, UUID.fromString(authentication.getName()));
        annotationService.setVisible(sessionId, request.visible());
    }

    @Operation(summary = "판서 문서 복원",
            description = "저장된 판서를 마지막 스냅샷과 그 이후 op로 돌려준다. 강사가 새로고침한 뒤 "
                    + "이걸로 복원하고, nextRevision부터 이어서 채번한다.")
    @GetMapping("/api/live-sessions/{sessionId}/annotation")
    public AnnotationDocumentResponse document(
            @PathVariable UUID sessionId,
            @RequestHeader(value = "Authorization", required = false) String authorization,
            Authentication authentication) {
        /*
         * 읽는 주체가 둘이다(ADR-0055).
         *
         *   강사·수강생  세션 쿠키 → 참가자 게이트
         *   Egress      LiveKit 토큰 → 그 방의 참가자임을 증명
         *
         * Egress는 헤드리스 Chrome이라 세션 쿠키가 없다. 그렇다고 판서 전체를 데이터 채널로 밀면
         * 64KB 한도에 걸린다(실측 74.9KB) — 그래서 스스로 가져가야 하고, 가진 것이 LiveKit 토큰뿐이다.
         *
         * 쓰기(append)에는 이 길을 열지 않는다. 방에 들어올 수 있다는 것과 문서를 고칠 수 있다는
         * 것은 다르다.
         */
        UUID viewer = sessionUser(authentication);
        if (viewer != null) {
            accessGuard.requireCanAccess(sessionId, viewer);
        } else {
            roomTokenVerifier.requireRoomParticipant(sessionId, authorization);
        }
        LiveAnnotationService.AnnotationDocumentView view = annotationService.restore(sessionId);
        return new AnnotationDocumentResponse(
                view.revision(),
                annotationService.nextRevision(sessionId),
                view.snapshotPayload(),
                view.ops().stream()
                        .map(op -> new AnnotationDocumentResponse.Op(op.revision(), op.opType(), op.payload()))
                        .toList());
    }

    /**
     * 세션 쿠키로 로그인한 사용자. 없으면 null이고, 그때는 LiveKit 토큰을 본다.
     *
     * <p>이 경로는 {@code permitAll}이라 로그인하지 않은 요청도 여기까지 들어온다. 지금은 익명
     * 요청에서 이 파라미터가 null로 들어오지만(서블릿 principal은 익명 토큰을 null로 준다),
     * <b>그 사실에 기대지 않는다</b> — 익명 토큰이 그대로 넘어오면 {@code UUID.fromString}이 터져
     * Egress가 토큰을 제대로 들고 와도 500이 되고, 판서는 수강생 화면에서만 사라진다. 이름이
     * userId가 아닌 주체는 전부 "로그인 아님"으로 떨어뜨린다(카탈로그 공개 조회도 같은 처리다).
     */
    private static UUID sessionUser(Authentication authentication) {
        if (authentication == null
                || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken) {
            return null;
        }
        try {
            return UUID.fromString(authentication.getName());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
