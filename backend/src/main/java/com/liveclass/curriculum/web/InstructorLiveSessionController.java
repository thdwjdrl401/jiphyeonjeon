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
@Tag(name = "라이브 세션 생성(강사)", description = "레슨에 라이브 세션을 만든다. 소유자만.")
@RestController
public class InstructorLiveSessionController {

    private final InstructorCurriculumService service;

    public InstructorLiveSessionController(InstructorCurriculumService service) {
        this.service = service;
    }

    @Operation(summary = "라이브 세션 생성", description = "레슨당 1개. 이미 있으면 409.")
    @PostMapping("/api/instructor/lessons/{lessonId}/live-sessions")
    @ResponseStatus(HttpStatus.CREATED)
    public LiveSessionView create(@PathVariable UUID lessonId,
                                  @RequestBody(required = false) CreateLiveSessionRequest request,
                                  Authentication authentication) {
        var scheduledAt = request == null ? null : request.scheduledAt();
        return service.createLiveSession(UUID.fromString(authentication.getName()), lessonId, scheduledAt);
    }
}
