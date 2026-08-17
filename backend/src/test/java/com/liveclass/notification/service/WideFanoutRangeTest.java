package com.liveclass.notification.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.math.BigInteger;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 넓은 팬아웃을 나눌 때 <b>빈틈도 겹침도 없는지</b>(ADR-0130).
 *
 * <p>여기가 틀리면 눈에 안 띄는 유실이 된다. 100만 명이 2<sup>128</sup> 공간에 흩어져 있어 경계
 * 하나를 잘못 잡아도 대부분의 실행에서 아무 일도 일어나지 않고, 어쩌다 그 자리에 있던 사람만
 * 알림을 못 받는다. 실제로 벤치 스크립트에 그런 off-by-one이 있었다 — 값 하나가 어느 구간에도
 * 들지 않았고, 100만 명 중 아무도 그 값을 갖지 않아 드러나지 않았다.
 *
 * <p><b>{@link UUID#compareTo}로 검산하지 않는다.</b> Java는 두 {@code long}을 부호 있게 비교해
 * 최상위 비트가 선 uuid를 앞으로 보내고, Postgres는 16바이트를 부호 없이 비교한다. 조각 SQL이
 * 도는 곳은 Postgres이므로 검산도 부호 없는 정수로 한다.
 */
class WideFanoutRangeTest {

    private static BigInteger asInt(UUID u) {
        return new BigInteger(1, java.nio.ByteBuffer.allocate(16)
                .putLong(u.getMostSignificantBits())
                .putLong(u.getLeastSignificantBits())
                .array());
    }

    @ParameterizedTest(name = "{0}갈래")
    @ValueSource(ints = {1, 2, 3, 4, 6, 8, 16})
    @DisplayName("구간들이 uuid 공간을 빈틈없이 정확히 한 번씩 덮는다")
    void ranges_cover_the_space_exactly_once(int n) {
        List<UUID[]> ranges = WideFanoutPublisher.ranges(n);
        assertThat(ranges).hasSize(n);

        // 첫 구간은 아래가 열려 있고, 마지막 구간은 위가 열려 있다.
        assertThat(ranges.getFirst()[0]).as("첫 구간의 시작은 제한 없음").isNull();
        assertThat(ranges.getLast()[1]).as("마지막 구간의 끝은 제한 없음").isNull();

        for (int i = 0; i < n - 1; i++) {
            UUID until = ranges.get(i)[1];
            UUID nextAfter = ranges.get(i + 1)[0];
            assertThat(until).as("중간 구간의 끝은 정해져 있다").isNotNull();
            /*
             * **경계값이 같아야 한다.** SQL이 `> after AND <= until`이므로, 앞 구간이 B에서
             * 끝나면 뒤 구간은 `> B`로 시작해야 B 다음 값부터 이어진다. 다른 값을 쓰면 그
             * 사이가 어느 구간에도 안 들어간다.
             */
            assertThat(nextAfter).as("이웃한 구간은 같은 경계값을 공유한다").isEqualTo(until);
        }
    }

    @ParameterizedTest(name = "{0}갈래")
    @ValueSource(ints = {2, 3, 4, 6, 8, 16})
    @DisplayName("구간 경계가 부호 없는 순서로 오름차순이다 — Postgres와 같은 순서")
    void boundaries_ascend_in_unsigned_order(int n) {
        List<UUID[]> ranges = WideFanoutPublisher.ranges(n);
        BigInteger previous = BigInteger.valueOf(-1);
        for (int i = 0; i < n - 1; i++) {
            BigInteger cut = asInt(ranges.get(i)[1]);
            assertThat(cut).as("경계가 앞의 것보다 크다").isGreaterThan(previous);
            previous = cut;
        }
    }

    @Test
    @DisplayName("갈래가 하나면 나누기 전과 같다 — 양쪽이 다 열린 구간 하나")
    void a_single_chain_is_unbounded() {
        List<UUID[]> ranges = WideFanoutPublisher.ranges(1);
        assertThat(ranges).hasSize(1);
        assertThat(ranges.getFirst()).containsExactly(null, null);
    }

    @Test
    @DisplayName("두 갈래는 공간을 반으로 가른다")
    void two_chains_split_the_space_in_half() {
        List<UUID[]> ranges = WideFanoutPublisher.ranges(2);
        UUID cut = ranges.getFirst()[1];
        assertThat(cut).hasToString("7fffffff-ffff-ffff-ffff-ffffffffffff");
        assertThat(ranges.get(1)[0]).isEqualTo(cut);
    }
}
