package com.liveclass.video.domain;

/**
 * 다시보기 공개 상태.
 *
 * <p><b>검수 단계가 없다.</b> 정상 녹화는 Egress 완료 webhook 한 트랜잭션에서 {@code DRAFT →
 * PUBLISHED}로 바로 간다(ADR-choinhoo/0007). 라이브는 학생이 이미 실시간으로 본 것이고 녹화는 그
 * 사본이라, 실시간에 공개한 것을 녹화만 다시 검수한다는 축이 성립하지 않는다. 강사가 검수를 잊으면
 * 학생이 영영 못 보는 쪽이 사고 녹화보다 비싸고, 사고는 {@code WITHDRAWN}으로 되돌린다.
 *
 * <p>그래서 {@code READY_FOR_REVIEW}를 뺐다 — <b>어디서도 설정한 적이 없는 값</b>이었다(운영 데이터
 * 32건 전수 확인: PUBLISHED 30 · DRAFT 2, 그 DRAFT도 전부 FAILED다). 값이 남아 있는 동안 화면과
 * 문서가 "검수하고 게시한다"고 말했고, 코드는 그 반대였다(ADR-0090).
 */
public enum ReplayStatus {
    /** 녹화 시작 시점. 완료되면 자동으로 PUBLISHED가 된다 — 여기 남아 있으면 대개 실패한 자산이다. */
    DRAFT,
    PUBLISHED,
    /** 강사가 내렸다. 다시 올리려면 수동 publish를 부른다 — 그것이 그 API의 실제 용도다. */
    WITHDRAWN
}
