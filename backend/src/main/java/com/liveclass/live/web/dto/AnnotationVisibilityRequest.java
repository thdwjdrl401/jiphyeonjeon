package com.liveclass.live.web.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 판서 표시 상태 변경 요청(ADR-0056).
 *
 * @param visible 수강생 화면에 보여줄지. 판서 <b>내용</b>이 아니라 표시 상태다 — 꺼도 문서는 남고,
 *                다시 켜면 그대로 돌아온다.
 */
public record AnnotationVisibilityRequest(@NotNull Boolean visible) {
}
