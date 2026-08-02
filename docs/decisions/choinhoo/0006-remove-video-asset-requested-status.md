# ADR-0006: 사용하지 않는 VideoAsset REQUESTED 상태를 제거한다

> 관련 결정: [ADR-0002 라이브 시작·Egress 게이트](0002-live-start-egress-stt-orchestration.md) ·
> [ADR-0003 라이브 종료 순차 처리](0003-simple-live-end-sequential-process.md) ·
> [ADR-0005 학생 HLS·자막 drain](0005-ended-hls-caption-drain.md) ·
> [공유 계약](../../CONTRACT.md)

- **상태**: 채택·구현
- **일자**: 2026-07-31
- **적용 범위**: `VideoAssetStatus`, `core.video_asset.status`, 녹화 상태 문서

## 맥락

`REQUESTED`는 Java enum과 최초 DB 기본값에만 남아 있었다. 현재 녹화 시작 경로는 새 자산을 만들거나
실패 자산을 재시도할 때 Egress 외부 호출 전에 곧바로 `STARTING`을 명시하고 `saveAndFlush`한다.
애플리케이션이 `REQUESTED`를 저장하거나 분기 조건으로 소비하는 경로는 없다.

사용되지 않는 상태를 남기면 처리 화면과 운영 쿼리가 실제로 도달 가능한 상태를 오해하고,
상태 전이 테스트도 불필요하게 복잡해진다.

## 결정

- Java `VideoAssetStatus.REQUESTED`를 제거한다.
- 현재 상태 목록은 `STARTING`·`RECORDING`·`FINALIZING`·`VERIFYING`·`READY`·`FAILED` 여섯 개다.
- 기존 DB의 `REQUESTED` 행은 동작 의미가 가장 가까운 `STARTING`으로 이관한다.
- `core.video_asset.status`의 `DEFAULT 'REQUESTED'`는 제거한다. 상태 없는 직접 INSERT를 허용하지 않고
  애플리케이션이 상태를 명시하게 한다.
- DB CHECK 제약에서도 `REQUESTED`를 제거한다.
- 적용된 최초 migration의 checksum을 바꾸지 않고 후속 `V15__remove_video_asset_requested_status.sql`로
  데이터 이관과 제약 변경을 수행한다.

정상 상태 흐름은 다음과 같다.

```text
(신규 또는 재시도할 FAILED)
  → STARTING
  → RECORDING
  → FINALIZING
  → VERIFYING
  → READY
```

`VERIFYING`은 현재 최종 확정과 같은 트랜잭션에서 처리되어 일반 조회에서 거의 관찰되지 않는다는
기존 특성은 이번 결정에서 바꾸지 않는다.

## 결과

- 코드·DB·설계 문서의 상태 집합이 실제 생성 경로와 일치한다.
- 기존 `REQUESTED` 데이터는 유실되지 않고 `STARTING`으로 이어진다.
- Flyway가 이미 적용된 환경에서도 기존 migration checksum 충돌 없이 배포할 수 있다.

## 검증

- enum 이름에 `REQUESTED`가 없다.
- migration 적용 후 `video_asset.status` 기본값이 없다.
- DB CHECK 제약은 여섯 상태만 허용한다.
- 기존 녹화 시작·종료·webhook 계약 테스트가 통과한다.
