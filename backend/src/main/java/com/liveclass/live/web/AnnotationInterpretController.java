package com.liveclass.live.web;

import com.liveclass.live.service.AnnotationInterpretService;
import com.liveclass.live.service.LiveAccessGuard;
import com.liveclass.live.web.dto.AnnotationInterpretRequest;
import com.liveclass.live.web.dto.AnnotationInterpretResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 판서 해석(ADR-0054, CONTRACT §3-6e).
 *
 * <p><b>여기서 판서를 바꾸지 않는다.</b> 결과는 <b>제안</b>이고, 문서에 넣는 주체는 강사의
 * Excalidraw 씬이다. 서버가 데이터 채널에 직접 쓰면 revision 채번의 단일 writer 전제가 깨지고,
 * 그 어긋남은 <b>강사 화면에 드러나지 않는다</b>(§3-6b).
 *
 * <p>그래서 이 API는 저장도 발행도 하지 않는다. 읽고 돌려줄 뿐이다.
 *
 * <p>인가는 <b>소유 강사만</b>이다 — 판서 문서를 고치는 행위이므로 §3-6d의 쓰기 게이트와 같다.
 */
@Tag(name = "라이브 판서", description = "판서 op 적재·복원(REST). 실시간 전달은 LiveKit 데이터 채널로 별개.")
@RestController
public class AnnotationInterpretController {

    private final AnnotationInterpretService interpretService;
    private final LiveAccessGuard accessGuard;

    public AnnotationInterpretController(AnnotationInterpretService interpretService, LiveAccessGuard accessGuard) {
        this.interpretService = interpretService;
        this.accessGuard = accessGuard;
    }

    @Operation(summary = "판서 해석",
            description = "손그림을 mermaid 정의 또는 LaTeX로 옮긴다. **좌표는 돌려주지 않는다** — "
                    + "실측에서 모델이 낸 좌표가 최대 96px 틀렸고, 같은 좌표는 클라이언트가 획의 점에서 "
                    + "오차 없이 얻는다. 배치는 클라이언트가 계산한다.")
    @PostMapping("/api/live-sessions/{sessionId}/annotation/interpret")
    public AnnotationInterpretResponse interpret(@PathVariable UUID sessionId,
                                                 @Valid @RequestBody AnnotationInterpretRequest request,
                                                 Authentication authentication) {
        accessGuard.requireOwner(sessionId, UUID.fromString(authentication.getName()));
        return AnnotationInterpretResponse.from(
                interpretService.interpret(request.mode(), request.image(), request.elementIds()));
    }
}
