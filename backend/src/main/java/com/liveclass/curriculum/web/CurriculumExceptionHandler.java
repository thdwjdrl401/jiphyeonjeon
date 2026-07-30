package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CurriculumNotFoundException;
import com.liveclass.curriculum.service.CurriculumNotPublishableException;
import com.liveclass.curriculum.service.CurriculumStateConflictException;
import com.liveclass.curriculum.service.LessonAccessDeniedException;
import com.liveclass.curriculum.service.LessonNotFoundException;
import com.liveclass.curriculum.service.NotCurriculumOwnerException;
import com.liveclass.curriculum.service.SectionNotEmptyException;
import com.liveclass.curriculum.service.SectionNotFoundException;
import com.liveclass.curriculum.service.StructureInvalidException;
import com.liveclass.curriculum.service.StructureVersionConflictException;
import com.liveclass.curriculum.web.dto.StructureConflictResponse;
import com.liveclass.common.web.ErrorResponse;
import com.liveclass.enrollment.api.EnrollmentNotFoundException;
import com.liveclass.enrollment.api.EnrollmentStateConflictException;
import com.liveclass.lesson.api.MaterialAlreadyAttachedException;
import com.liveclass.lesson.api.MaterialAssetInvalidException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 커리큘럼 도메인 실패 → CONTRACT §2 상태코드(없음 404·권한 403·충돌 409)로 매핑. */
// 범용 Exception 핸들러보다 먼저 뽑히도록 우선순위를 명시한다.
@Order(Ordered.LOWEST_PRECEDENCE - 100)
@RestControllerAdvice(assignableTypes = {
        InstructorCurriculumController.class, InstructorLessonController.class,
        InstructorLiveSessionController.class, CatalogController.class,
        StudentEnrollmentController.class, InstructorEnrollmentController.class,
        StudentLessonController.class})
public class CurriculumExceptionHandler {

    /** 수강 기록 없음(취소 대상 없음 등). */
    @ExceptionHandler(EnrollmentNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleEnrollmentNotFound(EnrollmentNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("ENROLLMENT_NOT_FOUND", e.getMessage()));
    }

    /** 허용되지 않는 수강 상태 전이(중복 신청·잘못된 승인 등). */
    /** 게시 선행 조건(섹션·강의 각 1개 이상) 미충족. 메시지가 무엇을 추가해야 하는지 알려 준다. */
    @ExceptionHandler(CurriculumNotPublishableException.class)
    public ResponseEntity<ErrorResponse> handleNotPublishable(CurriculumNotPublishableException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("CURRICULUM_NOT_PUBLISHABLE", e.getMessage()));
    }

    @ExceptionHandler(EnrollmentStateConflictException.class)
    public ResponseEntity<ErrorResponse> handleEnrollmentConflict(EnrollmentStateConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("ENROLLMENT_STATE_CONFLICT", e.getMessage()));
    }

    @ExceptionHandler({CurriculumNotFoundException.class, SectionNotFoundException.class, LessonNotFoundException.class})
    public ResponseEntity<ErrorResponse> handleNotFound(RuntimeException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("CURRICULUM_NOT_FOUND", e.getMessage()));
    }

    /**
     * 레슨 포트(lesson.api) 조작 중 레슨을 못 찾는 경우(소유권 확인과 포트 호출 사이의 동시 삭제 등).
     * 매핑이 없으면 500으로 새므로 404 LESSON_NOT_FOUND로 내린다.
     */
    @ExceptionHandler(com.liveclass.lesson.api.LessonNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleLessonNotFound(com.liveclass.lesson.api.LessonNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("LESSON_NOT_FOUND", e.getMessage()));
    }

    /**
     * 자료 연결 대상 에셋이 유효하지 않음(없음·kind 불일치·미완료·업로더 불일치) → 400.
     * lesson.api 경계 예외라 여기서 매핑한다(구현 모듈 예외를 curriculum이 참조하면 순환).
     */
    @ExceptionHandler(MaterialAssetInvalidException.class)
    public ResponseEntity<ErrorResponse> handleMaterialInvalid(MaterialAssetInvalidException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of("MATERIAL_INVALID", e.getMessage()));
    }

    /** 같은 (레슨, 에셋) 자료가 이미 연결돼 있음 → 409. */
    @ExceptionHandler(MaterialAlreadyAttachedException.class)
    public ResponseEntity<ErrorResponse> handleMaterialConflict(MaterialAlreadyAttachedException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("MATERIAL_ALREADY_ATTACHED", e.getMessage()));
    }

    /**
     * 레슨은 공개 목차에 보이지만 수강하지 않아 열 수 없다.
     * 코드는 목차 access의 reasonCode와 같은 값을 써서 FE가 같은 분기로 다룰 수 있게 한다.
     */
    @ExceptionHandler(LessonAccessDeniedException.class)
    public ResponseEntity<ErrorResponse> handleLessonAccessDenied(LessonAccessDeniedException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of("ENROLLMENT_REQUIRED", e.getMessage()));
    }

    /** 소유자가 아님. 존재는 하지만(404 아님) 권한이 없다. */
    @ExceptionHandler(NotCurriculumOwnerException.class)
    public ResponseEntity<ErrorResponse> handleNotOwner(NotCurriculumOwnerException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of("CURRICULUM_FORBIDDEN", e.getMessage()));
    }

    @ExceptionHandler(SectionNotEmptyException.class)
    public ResponseEntity<ErrorResponse> handleSectionNotEmpty(SectionNotEmptyException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("SECTION_NOT_EMPTY", e.getMessage()));
    }

    /** 허용되지 않는 lifecycle 전이. FE가 지정한 계약 코드를 쓴다. */
    @ExceptionHandler(CurriculumStateConflictException.class)
    public ResponseEntity<ErrorResponse> handleStateConflict(CurriculumStateConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("CURRICULUM_STATE_CONFLICT", e.getMessage()));
    }

    /**
     * 구조 순서 저장 요청이 현재 구조와 어긋남(누락·중복·이 커리큘럼 소속이 아닌 ID) → 400.
     * 전체 요청이 실패하며 부분 적용은 없다. message가 무엇이 잘못됐는지 알려준다.
     */
    @ExceptionHandler(StructureInvalidException.class)
    public ResponseEntity<ErrorResponse> handleStructureInvalid(StructureInvalidException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of("STRUCTURE_INVALID", e.getMessage()));
    }

    /**
     * baseVersion 불일치 → 409. 공용 봉투 대신 최신 structureVersion을 한 칸 더한 상위집합 본문을 내려
     * FE가 재조회 없이 최신 버전을 알 수 있게 한다(StructureConflictResponse 참고).
     */
    @ExceptionHandler(StructureVersionConflictException.class)
    public ResponseEntity<StructureConflictResponse> handleStructureVersionConflict(
            StructureVersionConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(StructureConflictResponse.of(
                        "STRUCTURE_VERSION_CONFLICT", e.getMessage(), e.getLatestVersion()));
    }

    /**
     * 동시 섹션 생성이 uq_section_order(curriculum_id, order_index)를 위반하면 커밋 시점에
     * DataIntegrityViolationException으로 올라온다. 500이 아니라 409로 내려 "다시 시도"를 알린다.
     * (제약은 STRUCTURE-01 원자적 순서저장을 위해 DEFERRABLE로 두므로 커밋에서 검증된다.)
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorResponse> handleConflict(DataIntegrityViolationException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("CURRICULUM_STRUCTURE_CONFLICT", "구조가 동시에 변경되었습니다. 다시 시도해 주세요."));
    }
}
