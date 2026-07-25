package com.liveclass.learning.web;

import com.liveclass.learning.service.LearningService;
import com.liveclass.learning.web.dto.BookmarkRequest;
import com.liveclass.learning.web.dto.LearningContextResponse;
import com.liveclass.learning.web.dto.ProgressUpdateRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 학습 상태(진도·북마크). 인증은 SecurityConfig의 anyRequest().authenticated()로 걸린다(로그인 필수).
 * 학습 자격(수강자인가)은 서비스가 LessonLearningAccess 로 판정한다 — 미수강 403, 없는 레슨 404.
 */
@Tag(name = "학습 상태", description = "레슨 진도와 북마크를 다룬다. 수강자만.")
@RestController
public class LearningController {

    private final LearningService learningService;

    public LearningController(LearningService learningService) {
        this.learningService = learningService;
    }

    @Operation(summary = "학습 컨텍스트 조회",
            description = "레슨의 내 진도와 북마크를 반환한다. 진도가 없으면 progress는 null.")
    @GetMapping("/api/lessons/{lessonId}/learning-context")
    public LearningContextResponse getContext(@PathVariable UUID lessonId, Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        return LearningContextResponse.from(learningService.getLearningContext(userId, lessonId));
    }

    @Operation(summary = "진도 갱신",
            description = "진도율(클라이언트 계산)과 재생 위치를 저장한다. 90% 이상이면 완료로 표시된다(sticky).")
    @PutMapping("/api/lessons/{lessonId}/progress")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void updateProgress(@PathVariable UUID lessonId,
                               @Valid @RequestBody ProgressUpdateRequest request,
                               Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        learningService.updateProgress(userId, lessonId, request.progressPercent(),
                request.lastPositionMs(), request.clientUpdatedAt());
    }

    @Operation(summary = "북마크 추가",
            description = "타임라인 위치를 북마크한다. 같은 위치를 다시 눌러도 중복 생성하지 않는다(멱등).")
    @PostMapping("/api/lessons/{lessonId}/bookmarks")
    @ResponseStatus(HttpStatus.CREATED)
    public void addBookmark(@PathVariable UUID lessonId,
                            @Valid @RequestBody BookmarkRequest request,
                            Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        learningService.addBookmark(userId, lessonId, request.sessionMs());
    }
}
