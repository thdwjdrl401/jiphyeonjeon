package com.liveclass;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

/**
 * 모듈 경계 검증. 손으로 지켜온 규칙(다른 모듈의 domain/repository 직접 참조 금지, 순환 의존 금지)을
 * Modulith가 컴파일 산출물 기준으로 자동 검증한다. 위반이 있으면 실패한다.
 */
class ModularityTests {

    private static final ApplicationModules modules = ApplicationModules.of(LiveClassApplication.class);

    @Test
    void verifiesModuleBoundaries() {
        modules.verify();
    }
}
