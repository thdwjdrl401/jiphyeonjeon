package com.liveclass.asset.web;

import com.liveclass.asset.service.AssetForbiddenException;
import com.liveclass.asset.service.AssetNotFoundException;
import com.liveclass.asset.service.AssetStateConflictException;
import com.liveclass.asset.service.AssetValidationException;
import com.liveclass.common.web.ErrorResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 에셋 도메인 실패 → CONTRACT §2 상태코드(없음 404·권한 403·잘못된 요청 400·충돌 409)로 매핑. */
// 범용 Exception 핸들러보다 먼저 뽑히도록 우선순위를 명시한다.
@Order(Ordered.LOWEST_PRECEDENCE - 100)
@RestControllerAdvice(assignableTypes = AssetController.class)
public class AssetExceptionHandler {

    @ExceptionHandler(AssetNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(AssetNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("ASSET_NOT_FOUND", e.getMessage()));
    }

    @ExceptionHandler(AssetForbiddenException.class)
    public ResponseEntity<ErrorResponse> handleForbidden(AssetForbiddenException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of("ASSET_FORBIDDEN", e.getMessage()));
    }

    @ExceptionHandler(AssetValidationException.class)
    public ResponseEntity<ErrorResponse> handleValidation(AssetValidationException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of("ASSET_INVALID", e.getMessage()));
    }

    /** 완료 통지가 왔지만 스토리지에 바이트가 아직 없음 → 재시도 가능한 충돌. */
    @ExceptionHandler(AssetStateConflictException.class)
    public ResponseEntity<ErrorResponse> handleStateConflict(AssetStateConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("ASSET_STATE_CONFLICT", e.getMessage()));
    }
}
