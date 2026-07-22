package com.liveclass.live.config;

import com.liveclass.live.api.LiveKitServerAccess;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(LiveKitProperties.class)
public class LiveKitConfig {

    /**
     * 서버 API 접속 정보를 경계 타입으로 공개한다. 설정 자체(LiveKitProperties)는 live 내부에 두고,
     * 접속용 wss URL → 서버 API용 https 변환도 여기서 한 번만 한다(호출자별 중복 방지).
     */
    @Bean
    public LiveKitServerAccess liveKitServerAccess(LiveKitProperties properties) {
        String apiUrl = properties.url()
                .replaceFirst("^wss://", "https://")
                .replaceFirst("^ws://", "http://");
        return new LiveKitServerAccess(apiUrl, properties.apiKey(), properties.apiSecret());
    }
}
