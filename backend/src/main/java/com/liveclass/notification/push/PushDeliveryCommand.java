package com.liveclass.notification.push;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

/**
 * 푸시 큐를 지나가는 명령(ADR-0124). 팬아웃 워커가 알림 행과 <b>같은 트랜잭션</b>에서 아웃박스에
 * 싣고, {@code PushDeliveryWorker}가 꺼내 발송한다.
 *
 * <p>팬아웃 메시지와 달리 <b>수신자 명단을 싣는다.</b> 팬아웃이 명단을 싣지 않는 이유(크기가
 * 수신자 수에 비례한다)는 여기에 적용되지 않는다 — 이 명령은 조각 하나에서 나오므로 크기가 조각
 * 상한(≤1,000명, 약 16KB)으로 유계다.
 *
 * <p><b>문구(title·body)까지 싣는 것도 의도다.</b> 소비자가 알림 행을 도로 SELECT하지 않게 하기
 * 위해서다 — 알림 테이블은 팬아웃 삽입으로 이미 가장 바쁜 표이고, 조각마다 조회를 하나 더 붙일
 * 이유가 없다. 문구는 조각 전체가 같으므로 명령 하나에 한 벌이면 된다.
 *
 * @param eventHash    사건 식별자. 알림 dedupe 키(넓은 팬아웃은 수신자를 붙이기 전의 접두)를
 *                     md5(uuid v3)로 접은 값이다. 진행 표의 키로 문자열 대신 uuid를 쓰면 파티션
 *                     로컬 인덱스가 절반 이하로 작다. <b>다른 목적의 dedupe 등록표와는 별개다.</b>
 * @param recipientIds 이 조각에서 <b>새로 알림을 받은</b> 사람들. 진행 표 anti-join의 모집합이다.
 * @param url          눌렀을 때 열 곳. 지금은 항상 {@code null}이다(분리 전 푸시도 null로 보냈다).
 * @param attempt      이 명령이 <b>몇 번째 시도</b>인가(ADR-0128). 푸시 서비스가 429로 막아
 *                     제한 시간 안에 못 보낸 사람들은 이 값을 하나 올린 새 명령으로 다시 실린다.
 *                     끝없이 도는 것을 막는 유일한 장치이므로 반드시 실어 나른다. 이 필드가
 *                     생기기 전에 발행된 메시지는 값이 없으므로 {@link #attemptOrFirst()}로 읽는다.
 */
public record PushDeliveryCommand(
        String type,
        UUID eventHash,
        List<UUID> recipientIds,
        String title,
        String body,
        String url,
        Integer attempt
) {

    /**
     * 큐에 이미 떠 있던 옛 메시지에는 {@code attempt}가 없다. 없으면 첫 번째다.
     *
     * <p>{@code int}가 아니라 {@code Integer}인 이유가 이것이다 — {@code int}면 없는 값이 0이 되어
     * "0번째 시도"라는 없는 상태가 생기고, 상한 비교가 한 번 더 도는 쪽으로 조용히 틀어진다.
     */
    public int attemptOrFirst() {
        return attempt == null || attempt < 1 ? 1 : attempt;
    }

    /** 같은 사건·같은 사람들을 다음 번째 시도로 다시 싣는다. 문구는 그대로 간다. */
    public PushDeliveryCommand nextAttempt(List<UUID> stillUnfinished) {
        return new PushDeliveryCommand(type, eventHash, List.copyOf(stillUnfinished),
                title, body, url, attemptOrFirst() + 1);
    }

    /**
     * dedupe 키 문자열 → 사건 해시. {@link UUID#nameUUIDFromBytes}가 곧 md5(uuid v3)라서 따로
     * 해시 라이브러리가 필요 없고, 같은 키는 어느 인스턴스에서 접어도 같은 uuid가 된다.
     */
    public static UUID eventHashOf(String dedupeKey) {
        return UUID.nameUUIDFromBytes(dedupeKey.getBytes(StandardCharsets.UTF_8));
    }
}
