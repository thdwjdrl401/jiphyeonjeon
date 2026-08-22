package com.liveclass.asset;

import com.liveclass.asset.config.AssetReaperProperties;
import com.liveclass.asset.config.AssetSchedulingConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.task.TaskSchedulingAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.scheduling.annotation.ScheduledAnnotationBeanPostProcessor;
import org.springframework.scheduling.config.ScheduledTaskRegistrar;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 노드 역할을 가르는 스위치가 실제로 주기 실행을 끄는지 확인한다(ADR-0127).
 *
 * <p>발송 전용 노드는 {@code liveclass.scheduling.enabled=false}로 뜬다. 이 값이 조용히 무시되면
 * 노드를 늘리는 순간 잠금 없는 잡(LiveStartingSoonScheduler)이 여러 대에서 같이 돌아 아웃박스에
 * 중복이 실린다 — 눈에 잘 띄지 않는 종류의 고장이라 코드로 고정해 둔다.
 *
 * <p>확인하는 것은 두 가지다. 스케줄 등록기가 아예 없다는 것과, <b>설정 프로퍼티 빈은 살아 있다</b>는
 * 것. 후자는 바깥 클래스에 조건을 걸었다가 {@code AssetReaperProperties}까지 사라져 그것을
 * 주입받는 잡이 기동을 실패시킨 실수를 막는다.
 */
class SchedulingActivationTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(TaskSchedulingAutoConfiguration.class))
            .withUserConfiguration(AssetSchedulingConfig.class);

    @Test
    @DisplayName("기본값은 켜짐 — 한 대로 돌리던 동작이 그대로다")
    void enabledByDefault() {
        runner.run(context -> {
            assertThat(context).hasSingleBean(ScheduledAnnotationBeanPostProcessor.class);
            assertThat(context).hasSingleBean(AssetReaperProperties.class);
        });
    }

    @Test
    @DisplayName("false면 스케줄 등록 자체가 없다")
    void disabledByProperty() {
        runner.withPropertyValues("liveclass.scheduling.enabled=false").run(context -> {
            assertThat(context).doesNotHaveBean(ScheduledAnnotationBeanPostProcessor.class);
            assertThat(context).doesNotHaveBean(ScheduledTaskRegistrar.class);
            // 설정은 남는다 — 이걸 주입받는 잡 빈이 기동을 실패시키면 안 된다.
            assertThat(context).hasSingleBean(AssetReaperProperties.class);
        });
    }
}
