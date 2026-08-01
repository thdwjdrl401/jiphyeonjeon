package com.liveclass.live.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * 판서 복원 체크포인트 저장 요청(ADR-0057).
 *
 * @param revision 이 체크포인트가 반영한 마지막 op 번호. 복원은 이보다 큰 op만 얹는다.
 * @param payload  문서 본문(JSON 문자열). 서버는 해석하지 않는다 — Excalidraw가 필드를 늘릴 때마다
 *                 서버 마이그레이션이 따라오지 않게 하기 위해서다(§3-6d).
 */
public record AnnotationSnapshotRequest(

        @NotNull @PositiveOrZero Long revision,

        /*
         * 상한을 둔다. 체크포인트는 문서 전체라 판서가 길어질수록 커지는데, Spring에는 JSON 본문
         * 기본 상한이 없어 그대로 두면 메모리를 그만큼 먹는다. 실측에서 요소 53개가 66KB였으므로
         * 8MB면 그 100배 이상이다.
         */
        @NotBlank @Size(max = 8_000_000) String payload) {
}
