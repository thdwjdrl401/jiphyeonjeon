package com.liveclass.live.service;

import com.liveclass.aiintegration.api.ReplayRagAnswerCommand.Caption;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 다시보기 질문 시점 주변의 확정 자막을 고르는 규칙(ADR-0042 "필요한 초기 범위").
 *
 * <p>순수 함수다 — 입력은 이미 세션 상대 ms로 변환된 발화 목록이고, 여기서는 <b>어느 것을 보낼지</b>만
 * 정한다. 변환(앵커 적용)은 {@link ReplayAiContextService}가 먼저 끝낸다.
 *
 * <p>규칙:
 * <ol>
 *   <li>질문 시점 <b>뒤에 시작한</b> 발화는 제외 — 사용자가 아직 듣지 않은 말을 근거로 삼지 않는다.</li>
 *   <li>질문 시점을 포함하는 발화는 통째로 포함(중간에 자르지 않는다).</li>
 *   <li>그 발화 시작에서 뒤로 30초까지 거슬러 포함. 겹치기만 해도(끝이 창 안이면) 포함한다.</li>
 *   <li>상한: 20개 · 합계 6,000자. 넘으면 <b>오래된 것부터</b> 버린다 — 질문 시점에 가까운 말이 더 값지다.</li>
 * </ol>
 */
final class ReplayCaptionWindow {

    /** 포함 발화 시작에서 거슬러 올라가는 창 길이. */
    static final long LOOKBACK_MS = 30_000;

    /** 보낼 발화 개수 상한. */
    static final int MAX_SEGMENTS = 20;

    /** 보낼 발화 text 합계 상한. */
    static final int MAX_TEXT_CHARS = 6_000;

    private ReplayCaptionWindow() {
    }

    /**
     * @param candidates        세션의 확정 발화 전부(세션 ms로 변환 완료, 정렬 무관)
     * @param questionSessionMs 질문을 누른 순간의 재생 위치
     * @return 시간순 오름차순. 근거로 쓸 발화가 없으면 빈 목록
     */
    static List<Caption> select(List<Caption> candidates, long questionSessionMs) {
        List<Caption> heard = candidates.stream()
                .filter(c -> c.startSessionMs() <= questionSessionMs)
                .sorted(Comparator.comparingLong(Caption::startSessionMs)
                        .thenComparingLong(Caption::segmentIndex))
                .toList();

        // 질문 시점을 품은 발화가 있으면 그 시작이 창의 기준점이다. 없으면(발화 사이 공백에서 질문)
        // 질문 시점 자체가 기준점 — 직전 30초의 말을 근거로 준다.
        long windowStart = heard.stream()
                .filter(c -> c.endSessionMs() >= questionSessionMs)
                .mapToLong(Caption::startSessionMs)
                .min()
                .orElse(questionSessionMs) - LOOKBACK_MS;

        List<Caption> inWindow = new ArrayList<>(heard.stream()
                .filter(c -> c.endSessionMs() >= windowStart)
                .toList());

        // 상한은 뒤(질문 시점)에서부터 채운다 — 잘려야 한다면 먼 과거가 먼저 잘린다.
        while (inWindow.size() > MAX_SEGMENTS) {
            inWindow.removeFirst();
        }
        while (inWindow.size() > 1 && totalChars(inWindow) > MAX_TEXT_CHARS) {
            inWindow.removeFirst();
        }
        return List.copyOf(inWindow);
    }

    private static int totalChars(List<Caption> segments) {
        return segments.stream().mapToInt(s -> s.text() == null ? 0 : s.text().length()).sum();
    }
}
