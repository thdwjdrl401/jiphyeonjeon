package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.InstructorCurriculumService;
import com.liveclass.curriculum.web.dto.CreateLiveSessionRequest;
import com.liveclass.live.api.LiveSessionView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 강사용 라이브 세션 생성(레슨 소유권 필요). 세션 데이터는 live 모듈이 소유하고, 여기선 소유권
 * 검증 후 위임한다 — curriculum → live 단방향(순환 없음).
 */
// Swagger 그룹은 리소스 단위로 통일한다 — 이 컨트롤러가 다른 모듈(curriculum)에 있어도
// live 세션 조회·토큰과 같은 "라이브 세션" 그룹으로 묶여 문서가 흩어지지 않게 한다.
@Tag(name = "라이브 세션", description = "라이브 세션 생성(강사)·조회·토큰·시작/종료.")
@RestController
public class InstructorLiveSessionController {

    private final InstructorCurriculumService service;

    public InstructorLiveSessionController(InstructorCurriculumService service) {
        this.service = service;
    }

    @Operation(summary = "라이브 세션 생성", description = "레슨에 라이브 강의 세션을 만든다(강사). 한 레슨에는 세션을 하나만 만들 수 있다.")
    @PostMapping("/api/instructor/lessons/{lessonId}/live-sessions")
    @ResponseStatus(HttpStatus.CREATED)
    public LiveSessionView create(@PathVariable UUID lessonId,
                                  @RequestBody(required = false) CreateLiveSessionRequest request,
                                  Authentication authentication) {
        var scheduledAt = request == null ? null : request.scheduledAt();
        return service.createLiveSession(UUID.fromString(authentication.getName()), lessonId, scheduledAt);
    }
}
