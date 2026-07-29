package com.liveclass.aiintegration.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** RAG 프록시 설정 바인딩. */
@Configuration
@EnableConfigurationProperties(RagApiProperties.class)
public class RagApiConfig {
}
