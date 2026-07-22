package com.liveclass.asset.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 에셋 모듈의 스케줄링 활성화. 공유 커널(common)을 건드리지 않도록 스케줄러가 필요한 모듈에서 켠다.
 * 현재 이 스케줄에 걸린 작업은 미완료 에셋 회수(AssetReaper) 하나뿐이다.
 */
@Configuration
@EnableScheduling
@EnableConfigurationProperties(AssetReaperProperties.class)
public class AssetSchedulingConfig {
}
