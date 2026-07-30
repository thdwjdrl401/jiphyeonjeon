package com.liveclass.live.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

class LiveKitAgentNameProfileTest {

    private final YamlPropertySourceLoader loader = new YamlPropertySourceLoader();

    @Test
    void baseProfileDefaultsToProductionAgent() throws IOException {
        assertThat(agentNameFrom("application.yml"))
                .isEqualTo("${LIVEKIT_AGENT_NAME:liveclass-realtime-stt-prod}");
    }

    @Test
    void remoteProfileDefaultsToDevelopmentAgent() throws IOException {
        assertThat(agentNameFrom("application-remote.yml"))
                .isEqualTo("${LIVEKIT_AGENT_NAME:liveclass-realtime-stt-dev}");
    }

    private Object agentNameFrom(String resourceName) throws IOException {
        List<PropertySource<?>> sources =
                loader.load(resourceName, new ClassPathResource(resourceName));
        return sources.stream()
                .map(source -> source.getProperty("livekit.agent-name"))
                .filter(value -> value != null)
                .findFirst()
                .orElse(null);
    }
}
