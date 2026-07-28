package com.liveclass.video;

import java.util.UUID;

/**
 * 재생 API 경로 규약. 컨트롤러의 {@code @GetMapping}과 metadata 응답이 싣는 URL이 같은 문자열을
 * 봐야 하는데, 서비스가 웹 계층을 참조할 수는 없어 양쪽이 함께 의존하는 중립 자리에 둔다.
 */
public final class PlaybackPaths {

    /** 매핑 선언용 — 애노테이션 인자라 컴파일 상수여야 한다. */
    public static final String MANIFEST_TEMPLATE = "/api/lessons/{lessonId}/playback/manifest";

    private PlaybackPaths() {
    }

    /** 응답에 싣는 실제 경로. */
    public static String manifest(UUID lessonId) {
        return "/api/lessons/" + lessonId + "/playback/manifest";
    }
}
