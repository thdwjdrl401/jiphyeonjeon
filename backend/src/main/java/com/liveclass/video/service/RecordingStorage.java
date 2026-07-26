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
}
