package com.liveclass.live.service;

import com.liveclass.aiintegration.api.ReplayRagAnswerCommand.Caption;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 다시보기 질문 시점 주변 자막 선별 규칙(ADR-0042 "필요한 초기 범위").
 *
 * <p>여기서 고정하는 것은 <b>무엇을 근거로 줄지</b>다. 잘못 고르면 AI가 사용자가 아직 듣지 않은 말을
 * 근거로 답하거나(미래 누설), 질문한 대목과 상관없는 옛 발화로 답한다.
 */
class ReplayCaptionWindowTest {

    @Test
    void excludes_utterances_that_start_after_the_question() {
        List<Caption> candidates = List.of(
                segment(0, 10_000, 12_000, "질문 전"),
                segment(1, 20_000, 22_000, "질문 후"));

        List<Caption> selected = ReplayCaptionWindow.select(candidates, 15_000);

        // 15초 지점에서 물었는데 20초의 말이 근거로 들어가면, 아직 듣지 않은 내용을 AI가 아는 셈이 된다.
        assertThat(texts(selected)).containsExactly("질문 전");
    }

    @Test
    void keeps_the_whole_utterance_that_contains_the_question() {
        List<Caption> candidates = List.of(
                segment(0, 10_000, 20_000, "질문 시점을 품은 긴 발화"));

        List<Caption> selected = ReplayCaptionWindow.select(candidates, 15_000);

        // 중간에서 물었어도 발화를 자르지 않는다 — 문장 반 토막은 근거가 못 된다.
        assertThat(texts(selected)).containsExactly("질문 시점을 품은 긴 발화");
    }

    @Test
    void looks_back_thirty_seconds_from_the_containing_utterance() {
        List<Caption> candidates = List.of(
                segment(0, 60_000, 62_000, "너무 오래됨"),      // 포함 발화 시작(100s) - 30s = 70s 밖
                segment(1, 69_000, 71_000, "창에 걸침"),        // 끝이 70s 이후라 포함
                segment(2, 80_000, 85_000, "창 안"),
                segment(3, 100_000, 110_000, "포함 발화"));

        List<Caption> selected = ReplayCaptionWindow.select(candidates, 105_000);

        assertThat(texts(selected)).containsExactly("창에 걸침", "창 안", "포함 발화");
    }

    @Test
    void falls_back_to_the_question_position_when_it_lands_in_a_gap() {
        List<Caption> candidates = List.of(
                segment(0, 10_000, 12_000, "창 밖"),
                segment(1, 55_000, 58_000, "직전 발화"));

        // 60초에 물었는데 그 순간에는 아무도 말하고 있지 않다 → 질문 시점 기준 30초를 거슬러 본다.
        List<Caption> selected = ReplayCaptionWindow.select(candidates, 60_000);

        assertThat(texts(selected)).containsExactly("직전 발화");
    }

    @Test
    void caps_the_count_keeping_the_utterances_nearest_the_question() {
        List<Caption> candidates = new ArrayList<>();
        for (int i = 0; i < 30; i++) {
            // 창 안에 30개를 촘촘히 넣는다(1초 간격).
            candidates.add(segment(i, 100_000L + i * 1_000L, 100_500L + i * 1_000L, "발화" + i));
        }

        List<Caption> selected = ReplayCaptionWindow.select(candidates, 130_000);

        assertThat(selected).hasSize(ReplayCaptionWindow.MAX_SEGMENTS);
        // 잘린다면 먼 과거가 잘린다 — 질문 시점에 가까운 말이 더 값지다.
        assertThat(texts(selected).getFirst()).isEqualTo("발화10");
        assertThat(texts(selected).getLast()).isEqualTo("발화29");
    }

    @Test
    void caps_the_total_text_length() {
        String long2000 = "가".repeat(2_000);
        List<Caption> candidates = List.of(
                segment(0, 100_000, 101_000, long2000),
                segment(1, 102_000, 103_000, long2000),
                segment(2, 104_000, 105_000, long2000),
                segment(3, 106_000, 107_000, long2000));

        List<Caption> selected = ReplayCaptionWindow.select(candidates, 108_000);

        // 8,000자는 상한(6,000)을 넘으므로 가장 오래된 하나가 빠진다.
        assertThat(selected).hasSize(3);
        assertThat(selected.stream().mapToInt(s -> s.text().length()).sum())
                .isLessThanOrEqualTo(ReplayCaptionWindow.MAX_TEXT_CHARS);
    }

    @Test
    void keeps_one_utterance_even_if_it_alone_exceeds_the_char_cap() {
        List<Caption> candidates = List.of(
                segment(0, 100_000, 110_000, "가".repeat(ReplayCaptionWindow.MAX_TEXT_CHARS + 1)));

        List<Caption> selected = ReplayCaptionWindow.select(candidates, 105_000);

        // 질문한 바로 그 대목이다. 길다고 통째로 버리면 근거가 0이 된다 — 상한보다 이 편이 낫다.
        assertThat(selected).hasSize(1);
    }

    @Test
    void returns_empty_when_nothing_was_said_before_the_question() {
        List<Caption> selected = ReplayCaptionWindow.select(
                List.of(segment(0, 50_000, 52_000, "나중 발화")), 10_000);

        // 자막이 없어도 실패가 아니다 — 자료만으로 답한다.
        assertThat(selected).isEmpty();
    }

    private static Caption segment(int index, long startMs, long endMs, String text) {
        return new Caption("stt-attempt-1", index, startMs, endMs, text);
    }

    private static List<String> texts(List<Caption> segments) {
        return segments.stream().map(Caption::text).toList();
    }
}
