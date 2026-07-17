package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CurriculumNotFoundException;
import com.liveclass.curriculum.service.NotCurriculumOwnerException;
import com.liveclass.curriculum.service.SectionNotEmptyException;
import com.liveclass.curriculum.service.SectionNotFoundException;
import com.liveclass.common.web.ErrorResponse;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 커리큘럼 도메인 실패 → CONTRACT §2 상태코드(없음 404·권한 403·충돌 409)로 매핑. */
@RestControllerAdvice(assignableTypes = {InstructorCurriculumController.class, CatalogController.class})
public class CurriculumExceptionHandler {

    @ExceptionHandler({CurriculumNotFoundException.class, SectionNotFoundException.class})
    public ResponseEntity<ErrorResponse> handleNotFound(RuntimeException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("CURRICULUM_NOT_FOUND", e.getMessage()));
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
