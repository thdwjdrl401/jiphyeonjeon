package com.liveclass.notification.service;

import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.config.NotificationMessagingConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 넓은 팬아웃을 <b>구간 여러 개로 나눠</b> 아웃박스에 싣는다(ADR-0130).
 *
 * <p><b>왜 나누나.</b> 조각 체인은 직렬이다 — 조각 N을 커밋해야 N+1이 발행되므로
 * ({@code NotificationFanoutWorker}가 삽입 뒤에 다음 조각을 낸다) 명령이 하나면 소비자를 늘려도
 * 한 사건의 팬아웃은 안 빨라진다. 큐에 메시지가 항상 하나뿐이라 나머지 소비자는 빈손이다.
 *
 * <p>수강생 100만 명 실측(Postgres 물리 2코어 전용):
 * <pre>
 *   체인 1개   35.8초      DB가 시간의 26%를 논다 — 앱이 다음 조각을 만드는 사이
 *   체인 2개   20.5초      그 틈이 메워진다
 *   체인 4개   21.0초      코어보다 백엔드가 많아져 서로 기다린다
 * </pre>
 *
 * <p><b>기본값이 2인 이유.</b> 벽시계는 2에서 8까지 평평했지만(20.5 → 18.9초) DB가 쓰는 시간은
 * 계속 늘었다(31.0 → 73.7초). 벤치는 DB가 팬아웃 전용이라 그게 안 아프지만 운영은 같은 Postgres가
 * 사용자 요청도 받는다. 8%를 더 벌자고 DB 부하를 2.4배 내는 것은 남는 장사가 아니다.
 *
 * <p>측정에서 나온 규칙은 <b>체인 수 ≈ Postgres 물리 코어 수</b>다. 코어가 더 많은 DB로 옮기면
 * 이 값을 올린다.
 *
 * <p><b>좁은 팬아웃은 쓰지 않는다.</b> 받는 사람이 한 명으로 정해진 알림은 나눌 것이 없다.
 */
@Component
public class WideFanoutPublisher {

    private static final Logger log = LoggerFactory.getLogger(WideFanoutPublisher.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    /** uuid 공간의 크기. 128비트를 <b>부호 없이</b> 다뤄야 Postgres의 uuid 정렬과 같다. */
    private static final BigInteger SPACE = BigInteger.ONE.shiftLeft(128);

    private final OutboxPublisher outboxPublisher;
    private final int chains;

    public WideFanoutPublisher(OutboxPublisher outboxPublisher,
                               @Value("${notification.fanout.chains:2}") int chains) {
        this.outboxPublisher = outboxPublisher;
        this.chains = Math.max(1, chains);
    }

    /**
     * 사건 하나를 구간 수만큼의 명령으로 싣는다.
     *
     * <p>멱등 키에 구간 번호를 붙인다 — 안 붙이면 두 번째 구간이 UNIQUE에 걸려 조용히 버려지고
     * 그 구간의 수강생은 알림을 못 받는다. 구간이 하나뿐이면 키를 그대로 둔다(나누기 전과 같다).
     */
    public void publish(NotificationFanoutCommand command, String aggregateType,
                        String aggregateId, String idempotencyKey) {
        // 한 명짜리 알림은 나눌 것이 없다. 나누면 명령만 늘고 나머지 갈래는 빈손으로 돌아간다.
        List<UUID[]> ranges = ranges(NotificationTypes.isWide(command.type()) ? chains : 1);
        for (int i = 0; i < ranges.size(); i++) {
            UUID[] range = ranges.get(i);
            outboxPublisher.enqueue(
                    NotificationMessagingConfig.FANOUT_QUEUE,
                    aggregateType,
                    aggregateId,
                    "NOTIFICATION_FANOUT_REQUESTED",
                    JSON.writeValueAsString(command.withRange(range[0], range[1])),
                    ranges.size() == 1 ? idempotencyKey : idempotencyKey + ":c" + (i + 1),
                    null);
        }
        log.debug("넓은 팬아웃 적재 type={} 구간={}개 key={}", command.type(), ranges.size(), idempotencyKey);
    }

    /**
     * uuid 공간을 {@code n}등분한 구간들. 각 구간은 {@code [after, until]}이고
     * {@code after}는 배타, {@code until}은 포함이다(조각 SQL이 {@code > after AND <= until}).
     *
     * <p><b>이웃한 구간은 같은 경계값을 공유한다.</b> 앞 구간이 B에서 끝나면 뒤 구간은
     * {@code > B}로 시작한다 — 서로 다른 값을 쓰면 그 사이의 uuid를 가진 사람이 어느 구간에도
     * 들지 않아 <b>알림을 못 받는다</b>. 100만 명이 2<sup>128</sup> 공간에 흩어져 있어 눈에 띄지
     * 않지만, 눈에 안 띄는 유실이 제일 나쁘다.
     *
     * <p><b>{@link UUID#compareTo}로 검산하면 안 된다.</b> Java는 두 {@code long}을 부호 있게
     * 비교해 최상위 비트가 선 uuid를 앞으로 보내고, Postgres는 16바이트를 부호 없이 비교한다.
     * 여기서는 {@link BigInteger}로 계산해 그 문제를 피한다.
     */
    static List<UUID[]> ranges(int n) {
        List<UUID[]> out = new ArrayList<>(n);
        if (n <= 1) {
            out.add(new UUID[] {null, null});
            return out;
        }
        BigInteger parts = BigInteger.valueOf(n);
        // cut(k) = 앞에서 k번째 구간의 마지막 값. 뒤 구간의 시작(배타)으로도 그대로 쓴다.
        List<UUID> cuts = new ArrayList<>(n - 1);
        for (int k = 1; k < n; k++) {
            cuts.add(uuidOf(SPACE.multiply(BigInteger.valueOf(k)).divide(parts).subtract(BigInteger.ONE)));
        }
        for (int i = 0; i < n; i++) {
            out.add(new UUID[] {
                    i == 0 ? null : cuts.get(i - 1),
                    i == n - 1 ? null : cuts.get(i)
            });
        }
        return out;
    }

    private static UUID uuidOf(BigInteger value) {
        String hex = String.format("%032x", value);
        return UUID.fromString(hex.substring(0, 8) + '-' + hex.substring(8, 12) + '-'
                + hex.substring(12, 16) + '-' + hex.substring(16, 20) + '-' + hex.substring(20));
    }
}
