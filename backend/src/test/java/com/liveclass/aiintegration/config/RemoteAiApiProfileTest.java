package com.liveclass.aiintegration.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 로컬 JVM이 remote 프로필에서 compose DNS가 아니라 EC2 dev ai-api를 호출하도록 고정한다. */
class RemoteAiApiProfileTest {

    private final YamlPropertySourceLoader loader = new YamlPropertySourceLoader();

    @Test
    void remote_profile_uses_the_ec2_dev_ai_api_by_default() throws IOException {
        PropertySource<?> remote = loadRemoteProfile();

        assertThat(remote.getProperty("liveclass.ai.api-base-url"))
                .isEqualTo("${AI_API_BASE_URL:http://jiphyeonjeon.thdwjdrl.com:18010}");
    }

    @Test
    void remote_profile_requires_the_shared_ai_internal_secret() throws IOException {
        PropertySource<?> remote = loadRemoteProfile();

        assertThat(remote.getProperty("liveclass.ai.internal-secret"))
                .isEqualTo("${AI_INTERNAL_SECRET}");
    }

    private PropertySource<?> loadRemoteProfile() throws IOException {
        List<PropertySource<?>> sources = loader.load(
                "application-remote.yml", new ClassPathResource("application-remote.yml"));
        assertThat(sources).as("application-remote.yml을 읽지 못했다").isNotEmpty();
        return sources.getFirst();
    }
}
