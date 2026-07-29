package com.liveclass.video.service;

/**
 * StartEgress 요청 전송 뒤 응답을 받지 못해 원격 commit 여부를 모르는 경우.
 *
 * <p>즉시 FAILED로 확정하거나 같은 요청을 다시 보내면 Egress가 중복될 수 있다. room 기준 list로
 * 재조정할 때까지 video_asset.STARTING을 유지한다(ADR-0002 §4 Gate A).
 */
public class EgressStartOutcomeUnknownException extends EgressControlException {

    public EgressStartOutcomeUnknownException(String message, Throwable cause) {
        super(message, cause);
    }
}
