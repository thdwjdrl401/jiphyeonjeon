package com.liveclass.common.logging;

import org.slf4j.Marker;
import org.slf4j.MarkerFactory;

/**
 * 감사 로그 공통 규약. 파이프라인(포맷·출력·correlation)은 공유하되, "무엇을 감사로 남길지"는
 * 각 모듈이 자기 로거로 소유한다. 이 마커를 달면 모듈에 상관없이 감사 이벤트만 필터·라우팅할 수 있다.
 *
 * 사용: {@code log.info(Audit.MARKER, "로그인 성공 userId={}", userId);}
 * 감사 로그엔 식별자(ID)만 남기고 비밀번호·이메일 같은 민감정보는 남기지 않는다.
 */
public final class Audit {

    public static final Marker MARKER = MarkerFactory.getMarker("AUDIT");

    private Audit() {
    }
}
