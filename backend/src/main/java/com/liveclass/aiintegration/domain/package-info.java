/**
 * AI 파이프라인 연동용 스키마 골격(transactional outbox / 멱등 inbox). 엔티티만 있고 아직 배선되지
 * 않았다 — 릴레이·컨슈머는 CP2 AI 파이프라인과 함께 붙인다(ADR-0024, DDL "CP2부터 활성").
 */
package com.liveclass.aiintegration.domain;
