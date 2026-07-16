package com.liveclass.common.web;

import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * T0 스모크: 앱이 뜨고 Redis 세션이 동작하는지 확인용. CP0에서 실제 도메인 컨트롤러로 대체.
 */
@RestController
@RequestMapping("/api")
public class SessionSmokeController {

    @GetMapping("/ping")
    public Map<String, String> ping() {
        return Map.of("status", "ok", "app", "liveclass");
    }

    /** 호출마다 세션 카운터 증가 → HttpOnly 쿠키 발급 + Redis에 세션 저장 확인. */
    @GetMapping("/session/touch")
    public Map<String, Object> touch(HttpSession session) {
        Integer count = (Integer) session.getAttribute("count");
        count = (count == null) ? 1 : count + 1;
        session.setAttribute("count", count);
        return Map.of("sessionId", session.getId(), "count", count);
    }
}
