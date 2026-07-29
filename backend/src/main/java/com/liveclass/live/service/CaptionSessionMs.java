package com.liveclass.live.service;

import java.time.Duration;
import java.time.OffsetDateTime;

/**
 * 근사 세션-ms 계산(occurredAt 기반, ADR-0045). 자막 델타에는 절대시각 {@code occurredAt}이,
 * 세션에는 클록 원점 {@code clockOriginAt}(t0)이 있으므로
 * {@code sessionMs = Duration.between(clockOriginAt, occurredAt)}로 근사한다.
 *
 * <p>이는 CONTRACT §3-4의 "raw {@code streamElapsedMs}는 앵커 없이 세션ms로 변환·중계 금지"에 대한
 * <b>의도적 편차</b>다 — streamElapsedMs가 아니라 occurredAt 기반 근사를 라이브 <b>표시용</b>으로만 쓴다
 * (정밀화는 AI 시간 앵커 대기, ADR-0045). 오차(STT 지연 + GPU↔Spring 시계 스큐 ~1~2s)는 영상 싱크에
 * 쓰는 HLS 지연(수초~수십초)보다 작다.
 *
 * <p>{@code clockOriginAt}이나 {@code occurredAt}이 없으면 {@code null}을 돌려준다(세션 시작 전 등).
 * 시계 스큐로 음수가 나오면 0으로 clamp한다 — 미디어 타임라인은 0 이전이 없고, {@code ChatService.elapsedMs}와
 * 동형이다. 음수를 그대로 흘리면 학생 위치 동기화에서 startMs가 음수가 되어 의미가 깨진다.
 */
public final class CaptionSessionMs {

    private CaptionSessionMs() {
    }

    /** 근사 세션-ms(≥0). 앵커/시각이 없으면 null. */
    public static Long approximate(OffsetDateTime clockOriginAt, OffsetDateTime occurredAt) {
        if (clockOriginAt == null || occurredAt == null) {
            return null;
        }
        return Math.max(0L, Duration.between(clockOriginAt, occurredAt).toMillis());
    }
}
