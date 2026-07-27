# ADR-0022: realtime 자막 Stream에 producer 측 길이 상한 적용

- **상태**: 채택
- **일자**: 2026-07-27
- **관련**: [ADR-0014](0014-realtime-agent-lifecycle-candidate-contract.md),
  [songjeongki ADR-0040](../songjeongki/0040-caption-delta-contract.md)

## 맥락

realtime-agent는 전역 Redis Stream `ai:captions:live`에 자막 이벤트를 `XADD`하지만 소비는 엔트리를
삭제하지 않는다. 기존 구현에는 `MAXLEN`, `MINID`, TTL이 없어 consumer 구현이나 정리가 늦어지면
Stream이 무한히 증가할 수 있다. application Redis는 세션과 캐시도 공유하므로 이 누적은 Redis와
호스트의 메모리 고갈 위험을 만든다.

Redis Stream의 `MAXLEN`은 엔트리 수 기준이며 바이트 기준 제한은 제공하지 않는다. 자막 모델은 개별
`text`를 최대 10,000자로 이미 제한하지만, producer 보존 상한과 Redis 인스턴스 전체 메모리 정책은
서로 다른 방어선이다.

## 결정

1. 모든 caption `XADD`에 `MAXLEN ~ 10000`을 기본 적용한다. 근사 trimming은 Stream 내부 노드 단위로
   오래된 엔트리를 효율적으로 제거하며 실제 길이가 기준을 소폭 초과할 수 있다.
2. 운영 환경은 `CAPTION_STREAM_MAXLEN` 양의 정수로 엔트리 상한을 조정할 수 있다. 0이나 음수를
   허용하지 않아 실수로 무제한 모드가 되는 것을 막는다.
3. 현재 후보 계약의 전역 key는 유지한다. 세션별 key와 종료 후 `DEL`/TTL은 Java consumer 계약을
   채택할 때 별도로 확정한다.
4. 이 결정은 Redis 전체의 바이트 hard cap을 뜻하지 않는다. `maxmemory`와 eviction policy는 세션
   유실 및 write 실패 영향을 함께 검토해 배포 인스턴스 용량이 정해진 뒤 별도 인프라 결정으로 둔다.

## 영향

- consumer가 멈추거나 아직 없어도 caption Stream 엔트리 수가 장기간 무한 증가하지 않는다.
- 상한을 넘은 가장 오래된 자막은 유실될 수 있다. 자막 Stream은 fast-path이고 유실 구간은 녹화본
  2-pass로 복구한다는 기존 아키텍처와 일치한다.
- `MAXLEN ~` 동작과 설정 검증은 publisher/config 단위 테스트로 고정한다. 메시지 필드 형식은 바뀌지
  않으므로 Java 계약 fixture와 `docs/CONTRACT.md`는 이번 변경 대상이 아니다.
