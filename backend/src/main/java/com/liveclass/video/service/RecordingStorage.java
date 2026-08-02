package com.liveclass.video.service;

import java.util.Optional;

/**
 * 녹화 산출물(HLS 매니페스트·세그먼트)이 실제로 스토리지에 올라왔는지 확인하는 포트(ADR-0034 VERIFYING).
 * webhook의 완료 신호만 믿지 않고 매니페스트 존재를 재확인해 "COMPLETE인데 파일이 없는" 케이스를 잡는다.
 */
public interface RecordingStorage {

    /**
     * 객체 존재를 HEAD로 확인한다.
     *
     * @return 존재하면 크기(bytes)를 담은 Optional, <b>부재가 확정</b>(404)이면 {@link Optional#empty()}
     * @throws RuntimeException 확인 자체가 실패(네트워크·설정 등)하면 던진다 — 호출자가 fail-open을 판단한다.
     *                         즉 "부재 확정"과 "확인 불가"를 구분한다(전자만 실패 처리 대상).
     */
    Optional<Long> head(String bucket, String key);

    /**
     * {@code prefix}로 시작하는 객체를 전부 지운다(강의 삭제 시 녹화 산출물 정리).
     *
     * <p>세그먼트가 수백 개일 수 있어 목록을 페이지로 훑으며 지운다. 없는 prefix면 조용히 0을 돌려준다(멱등)
     * — 재시도해도 안전해야 한다.
     *
     * @return 지운 객체 수
     * @throws RuntimeException 스토리지 접근 자체가 실패하면 던진다. 호출자가 "지웠다"와 "못 지웠다"를
     *                          구분해야 파일만 남는 상태를 알아챌 수 있다.
     */
    long deletePrefix(String bucket, String prefix);
}
