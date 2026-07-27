package com.liveclass.support;

import java.util.List;

import org.springframework.beans.factory.support.BeanDefinitionRegistry;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.AnnotatedBeanDefinitionReader;
import org.springframework.test.context.ContextConfigurationAttributes;
import org.springframework.test.context.ContextCustomizer;
import org.springframework.test.context.ContextCustomizerFactory;
import org.springframework.test.context.MergedContextConfiguration;

/**
 * {@link TestcontainersConfiguration}를 모든 테스트 컨텍스트에 자동 주입한다(ADR-0038).
 *
 * <p>META-INF/spring.factories에 ContextCustomizerFactory로 등록되어 있어 스프링 테스트가
 * 모든 컨텍스트 준비 단계에서 호출한다. 덕분에 ~37개의 @SpringBootTest 파일을 개별 수정하지 않고도
 * Testcontainers 인프라(Postgres+Redis)를 일괄 적용할 수 있다.
 *
 * <p>ContextCustomizer는 MergedContextConfiguration에 참여하므로 컨텍스트 캐시 키의 일부가 된다 —
 * 모든 테스트가 동일 커스터마이저를 받아 캐시가 쪼개지지 않고, 싱글턴 컨테이너를 그대로 공유한다.
 */
public class TestcontainersContextCustomizerFactory implements ContextCustomizerFactory {

    @Override
    public ContextCustomizer createContextCustomizer(
            Class<?> testClass, List<ContextConfigurationAttributes> configAttributes) {
        return TestcontainersContextCustomizer.INSTANCE;
    }

    /**
     * 모든 테스트가 같은 인스턴스를 받도록 싱글턴으로 둔다. equals/hashCode가 동일하므로
     * 컨텍스트 캐시가 이 커스터마이저 때문에 갈라지지 않는다.
     */
    private enum TestcontainersContextCustomizer implements ContextCustomizer {
        INSTANCE;

        @Override
        public void customizeContext(
                ConfigurableApplicationContext context, MergedContextConfiguration mergedConfig) {
            if (context.getBeanFactory() instanceof BeanDefinitionRegistry registry) {
                new AnnotatedBeanDefinitionReader(registry)
                        .registerBean(TestcontainersConfiguration.class);
            } else {
                throw new IllegalStateException(
                        "Cannot register Testcontainers configuration: bean factory is not a BeanDefinitionRegistry ("
                                + context.getBeanFactory().getClass() + ")");
            }
        }
    }
}
