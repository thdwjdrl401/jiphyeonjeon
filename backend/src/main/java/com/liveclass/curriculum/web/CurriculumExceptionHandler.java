package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CurriculumNotFoundException;
import com.liveclass.curriculum.service.NotCurriculumOwnerException;
import com.liveclass.curriculum.service.SectionNotEmptyException;
import com.liveclass.curriculum.service.SectionNotFoundException;
import com.liveclass.common.web.ErrorResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 커리큘럼 관리 실패 → CONTRACT §2 상태코드(없음 404·권한 403·충돌 409)로 매핑. */
@RestControllerAdvice(assignableTypes = InstructorCurriculumController.class)
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
}
