package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.InstructorCurriculumService;
import com.liveclass.curriculum.web.dto.CompleteRecordedVideoRequest;
import com.liveclass.curriculum.web.dto.CreateRecordedLessonRequest;
import com.liveclass.curriculum.web.dto.RecordedLessonResponse;
import com.liveclass.curriculum.web.dto.RecordedVideoUploadRequest;
import com.liveclass.video.api.RecordedProcessingView;
import com.liveclass.video.api.RecordedUploadTicket;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Tag(name = "녹화강의 관리(강사)", description = "MP4 원본을 직접 업로드하고 HLS 변환 상태를 관리한다.")
@RestController
public class InstructorRecordedLessonController {

    private final InstructorCurriculumService service;

    public InstructorRecordedLessonController(InstructorCurriculumService service) {
        this.service = service;
    }

    @Operation(summary = "녹화강의 생성")
    @PostMapping("/api/instructor/sections/{sectionId}/recorded-lessons")
    @ResponseStatus(HttpStatus.CREATED)
    public RecordedLessonResponse create(@PathVariable UUID sectionId,
                                         @Valid @RequestBody CreateRecordedLessonRequest request,
                                         Authentication authentication) {
        return RecordedLessonResponse.from(service.createRecordedLesson(
                currentUserId(authentication), sectionId, request.clientRequestId(),
                request.title(), request.description()));
    }

    @Operation(summary = "녹화강의 MP4 업로드 URL 발급")
    @PostMapping("/api/instructor/recorded-lessons/{lessonId}/video/upload-requests")
    @ResponseStatus(HttpStatus.CREATED)
    public RecordedUploadTicket issueUpload(@PathVariable UUID lessonId,
                                            @Valid @RequestBody RecordedVideoUploadRequest request,
                                            Authentication authentication) {
        return service.issueRecordedVideoUpload(
                currentUserId(authentication), lessonId,
                request.fileName(), request.contentType(), request.fileSize());
    }

    @Operation(summary = "녹화강의 MP4 업로드 완료 및 변환 접수")
    @PostMapping("/api/instructor/recorded-lessons/{lessonId}/video/complete")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public RecordedProcessingView complete(@PathVariable UUID lessonId,
                                           @Valid @RequestBody CompleteRecordedVideoRequest request,
                                           Authentication authentication) {
        return service.completeRecordedVideoUpload(
                currentUserId(authentication), lessonId, request.assetId());
    }

    @Operation(summary = "녹화강의 영상 처리 상태 조회")
    @GetMapping("/api/instructor/recorded-lessons/{lessonId}/processing")
    public RecordedProcessingView processing(@PathVariable UUID lessonId, Authentication authentication) {
        return service.getRecordedVideoProcessing(currentUserId(authentication), lessonId);
    }

    @Operation(summary = "실패한 녹화강의 영상 변환 재시도")
    @PostMapping("/api/instructor/recorded-lessons/{lessonId}/processing/retry")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public RecordedProcessingView retry(@PathVariable UUID lessonId, Authentication authentication) {
        return service.retryRecordedVideoProcessing(currentUserId(authentication), lessonId);
    }

    private UUID currentUserId(Authentication authentication) {
        return UUID.fromString(authentication.getName());
    }
}
