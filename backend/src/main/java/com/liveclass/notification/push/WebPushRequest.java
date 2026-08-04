package com.liveclass.notification.push;

import java.net.URI;
import java.util.Map;

/**
 * 푸시 서비스로 나갈 요청 하나. <b>이미 암호화·서명이 끝난 상태</b>다.
 *
 * <p>HTTP 라이브러리 타입을 쓰지 않는다 — 만드는 쪽(암호)과 보내는 쪽(전송)이 서로의 구현에
 * 묶이지 않게 하기 위해서다.
 */
public record WebPushRequest(URI endpoint, Map<String, String> headers, byte[] body) {
}
