package com.liveclass.learning.web;

import com.liveclass.learning.service.LearningService;
import com.liveclass.learning.service.LessonGlossaryService;
import com.liveclass.learning.service.WatchHeatmapService;
import com.liveclass.learning.web.dto.BookmarkRequest;
import com.liveclass.learning.web.dto.LearningContextResponse;
import com.liveclass.learning.web.dto.ProgressUpdateRequest;
import com.liveclass.learning.web.dto.GlossaryTermResponse;
import com.liveclass.learning.web.dto.GlossaryTermUpsertRequest;
import com.liveclass.learning.web.dto.WatchBucketReportRequest;
import com.liveclass.learning.web.dto.WatchHeatmapResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 학습 상태(진도·북마크). 인증은 SecurityConfig의 anyRequest().authenticated()로 걸린다(로그인 필수).
 * 학습 자격(수강자인가)은 서비스가 LessonLearningAccess 로 판정한다 — 미수강 403, 없는 레슨 404.
 */
@Tag(name = "학습 상태", description = "레슨 진도와 북마크를 다룬다. 수강자만.")
@RestController
public class LearningController {

    private final LearningService learningService;
    private final WatchHeatmapService watchHeatmapService;
    private final LessonGlossaryService glossaryService;

    public LearningController(LearningService learningService, WatchHeatmapService watchHeatmapService,
                              LessonGlossaryService glossaryService) {
        this.learningService = learningService;
        this.watchHeatmapService = watchHeatmapService;
        this.glossaryService = glossaryService;
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

    @Operation(summary = "북마크 삭제",
            description = "내 북마크 하나를 지운다. 이미 없거나 남의 것이면 조용히 무시한다(멱등).")
    @DeleteMapping("/api/lessons/{lessonId}/bookmarks/{bookmarkId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteBookmark(@PathVariable UUID lessonId,
                               @PathVariable UUID bookmarkId,
                               Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        learningService.deleteBookmark(userId, lessonId, bookmarkId);
    }

    @Operation(summary = "구간별 시청 횟수 보고",
            description = "재생한 칸의 누적 횟수를 올린다. 재생바의 '많이 다시 본 구간' 그래프와 칸 기준 진도의 "
                    + "원본이다. 누적 절대값이라 같은 것을 여러 번 보내도 결과가 같다. "
                    + "강사 재생은 기록하지 않는다 — 검수하며 되감은 것이 학생 재시청으로 잡히면 그래프가 오염된다.")
    @PutMapping("/api/lessons/{lessonId}/watch-buckets")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void reportWatchBuckets(@PathVariable UUID lessonId,
                                   @Valid @RequestBody WatchBucketReportRequest request,
                                   Authentication authentication) {
        // 칸 길이 검증은 요청 DTO가 한다(@AssertTrue) — 400으로 나가야 하기 때문이다.
        if (isInstructor(authentication)) {
            return;   // 강사 재생은 세지 않는다(조용히 무시 — 화면이 실패로 다룰 일이 아니다)
        }
        watchHeatmapService.record(UUID.fromString(authentication.getName()), lessonId, request.counts());
    }

    @Operation(summary = "내 구간별 시청 횟수",
            description = "새로고침 뒤 이어서 세려면 이미 쌓은 값을 알아야 한다. {칸번호: 재생횟수}.")
    @GetMapping("/api/lessons/{lessonId}/watch-buckets/me")
    public java.util.Map<Integer, Integer> myWatchBuckets(@PathVariable UUID lessonId,
                                                          Authentication authentication) {
        return watchHeatmapService.myBuckets(UUID.fromString(authentication.getName()), lessonId);
    }

    @Operation(summary = "많이 다시 본 구간 그래프",
            description = "칸별 재시청 강도. 절대 횟수가 아니라 도달한 사람 수로 나눈 값이라 "
                    + "이탈 때문에 뒤가 낮아지는 왜곡이 없다. 강의 길이와 무관하게 최대 100점으로 묶어 준다.")
    @GetMapping("/api/lessons/{lessonId}/watch-heatmap")
    public WatchHeatmapResponse watchHeatmap(@PathVariable UUID lessonId,
                                             @RequestParam(required = false) Long durationMs,
                                             Authentication authentication) {
        return WatchHeatmapResponse.from(
                watchHeatmapService.heatmap(UUID.fromString(authentication.getName()), lessonId, durationMs));
    }

    /** 강사 판정. 역할은 로그인 시 권한으로 실려 있어 별도 조회가 필요 없다. */
    private static boolean isInstructor(Authentication authentication) {
        return authentication.getAuthorities().stream()
                .anyMatch(a -> "ROLE_INSTRUCTOR".equals(a.getAuthority()));
    }

    @Operation(summary = "강의 용어집 조회",
            description = "AI가 자료에서 뽑은 용어(ai.material_key_term)를 강사 수정본이 덮어쓴 최종 목록. "
                    + "자막 매핑은 서버가 하지 않는다 — 화면이 이 목록으로 도착한 자막에서 직접 찾는다.")
    @GetMapping("/api/lessons/{lessonId}/glossary")
    public List<GlossaryTermResponse> glossary(@PathVariable UUID lessonId, Authentication authentication) {
        return glossaryService.glossary(UUID.fromString(authentication.getName()), lessonId).stream()
                .map(GlossaryTermResponse::from)
                .toList();
    }

    @Operation(summary = "용어 수정·추가(강사)",
            description = "ai 원본에 있는 용어면 정의를 덮고, 없으면 새 용어로 더한다. 같은 용어를 다시 보내면 덮어쓴다(멱등). "
                    + "원본은 건드리지 않는다 — ai 스키마는 읽기만 한다.")
    @PutMapping("/api/instructor/lessons/{lessonId}/glossary")
    public GlossaryTermResponse upsertGlossaryTerm(@PathVariable UUID lessonId,
                                                   @Valid @RequestBody GlossaryTermUpsertRequest request,
                                                   Authentication authentication) {
        return GlossaryTermResponse.from(glossaryService.upsert(
                UUID.fromString(authentication.getName()), lessonId, request.term(), request.definition()));
    }
}
