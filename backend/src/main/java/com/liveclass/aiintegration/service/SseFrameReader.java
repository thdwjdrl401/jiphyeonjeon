package com.liveclass.aiintegration.service;

import com.liveclass.aiintegration.api.RagSseEvent;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;

/**
 * `text/event-stream` 최소 파서. 빈 줄이 프레임 경계이므로 <b>줄 단위로 읽고 경계마다 즉시 넘긴다</b> —
 * 여기서 모아 두면 아래 릴레이가 아무리 빨라도 델타가 뭉친다.
 *
 * <p>`:`로 시작하는 주석(하트비트)과 모르는 field(`id`·`retry`)는 버린다. ai-api는 named event +
 * 한 줄 JSON data만 쓰지만(ai/ai-api/CONTRACT.md §3) 여러 줄 data도 규격대로 `\n`으로 잇는다.
 */
final class SseFrameReader {

    private SseFrameReader() {
    }

    static void read(InputStream body, Consumer<RagSseEvent> consumer) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8));
        String eventName = null;
        StringBuilder data = new StringBuilder();
        boolean hasData = false;
        String line;
        while ((line = reader.readLine()) != null) {
            if (line.isEmpty()) {                       // 프레임 경계 — 즉시 방출
                if (eventName != null || hasData) {
                    consumer.accept(new RagSseEvent(eventName, data.toString()));
                }
                eventName = null;
                data.setLength(0);
                hasData = false;
                continue;
            }
            if (line.charAt(0) == ':') {                // 주석/하트비트
                continue;
            }
            int colon = line.indexOf(':');
            String field = colon < 0 ? line : line.substring(0, colon);
            String value = colon < 0 ? "" : line.substring(colon + 1);
            if (!value.isEmpty() && value.charAt(0) == ' ') {
                value = value.substring(1);
            }
            if ("event".equals(field)) {
                eventName = value;
            } else if ("data".equals(field)) {
                if (hasData) {
                    data.append('\n');
                }
                data.append(value);
                hasData = true;
            }
        }
        if (eventName != null || hasData) {             // 마지막 프레임에 빈 줄이 없어도 흘리지 않는다
            consumer.accept(new RagSseEvent(eventName, data.toString()));
        }
    }
}
