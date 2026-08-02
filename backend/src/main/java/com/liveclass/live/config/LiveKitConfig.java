package com.liveclass.live.config;

import com.liveclass.live.api.LiveKitServerAccess;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties({LiveKitProperties.class, LiveStartProperties.class, CaptionStreamProperties.class, LectureNoteStreamProperties.class,
        AnnotationAiProperties.class})
public class LiveKitConfig {

    /**
     * 서버 API 접속 정보를 경계 타입으로 공개한다. 설정 자체(LiveKitProperties)는 live 내부에 둔다.
     *
     * <p>{@code livekit.api-url}이 있으면 그걸 쓰고, 없으면 브라우저용 {@code livekit.url}에서
     * 파생한다(wss→https). 변환은 여기서 한 번만 한다(호출자별 중복 방지).
     */
    @Bean
    public LiveKitServerAccess liveKitServerAccess(LiveKitProperties properties) {
        String configured = properties.apiUrl();
        String apiUrl = configured != null && !configured.isBlank()
                ? configured
                : properties.url()
                        .replaceFirst("^wss://", "https://")
                        .replaceFirst("^ws://", "http://");
        return new LiveKitServerAccess(
                apiUrl,
                properties.apiKey(),
                properties.apiSecret(),
                properties.controlTimeout());
    }
}
