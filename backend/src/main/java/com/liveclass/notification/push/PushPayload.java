package com.liveclass.notification.push;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * 서비스워커가 받을 본문. <b>여기에는 내용이 들어간다</b> — STOMP 신호와 다른 점이다.
 *
 * <p>탭이 닫혀 있으면 화면이 목록을 다시 읽을 수 없다. 그래서 푸시에는 제목·본문을 실어야 하고,
 * 그 값은 알림을 만들 때 이미 완성해 저장한 문구를 그대로 쓴다(ADR-0073 §7).
 */
final class PushPayload {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private PushPayload() {
    }

    static String json(String title, String body, String url) {
        ObjectNode node = JSON.createObjectNode();
        node.put("title", title);
        node.put("body", body);
        // 클릭했을 때 열 곳. 없으면 서비스워커가 알림함을 연다.
        node.put("url", url == null ? "/notifications" : url);
        return JSON.writeValueAsString(node);
    }
}
