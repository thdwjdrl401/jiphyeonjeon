package com.liveclass.common.config;

import org.springframework.boot.flyway.autoconfigure.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * V5 마이그레이션 주석 정정(ADR-0034→0035 오기)으로 파일 체크섬이 바뀌어, 이미 V5를 적용한
 * DB(로컬·EC2)는 부팅 검증에서 실패한다. repair가 적용 이력의 체크섬을 현재 파일 기준으로
 * 재기록한 뒤 migrate한다. 전 환경이 한 번씩 부팅되고 나면 제거해도 되는 한시 조치다.
 */
@Configuration
public class FlywayRepairConfig {

    @Bean
    public FlywayMigrationStrategy repairThenMigrate() {
        return flyway -> {
            flyway.repair();
            flyway.migrate();
        };
    }
}
