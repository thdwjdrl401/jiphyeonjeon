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
 */
public record PushDeliveryCommand(
        String type,
        UUID eventHash,
        List<UUID> recipientIds,
        String title,
        String body,
        String url
) {

    /**
     * dedupe 키 문자열 → 사건 해시. {@link UUID#nameUUIDFromBytes}가 곧 md5(uuid v3)라서 따로
     * 해시 라이브러리가 필요 없고, 같은 키는 어느 인스턴스에서 접어도 같은 uuid가 된다.
     */
    public static UUID eventHashOf(String dedupeKey) {
        return UUID.nameUUIDFromBytes(dedupeKey.getBytes(StandardCharsets.UTF_8));
    }
}
