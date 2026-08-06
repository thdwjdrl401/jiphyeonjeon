# Realtime agent contract artifacts

이 디렉터리는 realtime-agent의 JSON Schema와 대표 fixture를 보관한다. dispatch와 caption 4종
(delta/completed/started/final) 등 채택된 경계의 정본은 [`docs/CONTRACT.md`](../../../docs/CONTRACT.md)다.
started/final도 루트 계약에 채택됐고(ADR-0052·0053) Spring consumer가 영속·전달한다. service health는
AI endpoint와 Python 계약 테스트까지 구현됐고 Java consumer는 별도 backend 변경에서 연결한다.

## 경계

| Schema | Producer | Transport | Consumer |
|---|---|---|---|
| `dispatch-metadata.schema.json` | Spring dispatch adapter | LiveKit job metadata | realtime-agent |
| `caption-stream-entry.schema.json` | realtime-agent | Redis Stream | Spring은 4종 전부 영속(ADR-0052), ai-api는 delta/completed만 소비(계약상 제외) |
| `live-agent-status.schema.json` | realtime-agent | 서명된 내부 HTTP | 향후 Spring callback |
| `realtime-agent-health.schema.json` | realtime-agent | loopback/reverse tunnel HTTP | 향후 Spring consumer |

`sessionId`와 `lessonId`는 소문자 canonical UUID 문자열이다. 모든 payload 필드는
`camelCase`이고 알 수 없는 필드는 거부한다.

`streamElapsedMs`는 라이브 세션 생성 시각 기준 시간이 아니라 첫 오디오 프레임 시작을 0으로 한 단조
증가 시간이다. 후보 started 이벤트의 `audioStartedAt`은 그 0의 UTC 앵커다. 제안하는 Spring 변환은
raw 값을 보존하고 `audioStartedAt - clockOriginAt + streamElapsedMs`로 세션 축을 만드는 방식이며,
fallback과 버전 정책을 포함해 아직 미확정이다.

caption `sequence`는 `(sessionId, sttSessionId)`로 식별되는 한 job attempt의 STT stream 안에서만
단조 증가한다. 순차 retry는 새 `sttSessionId`로 다시 `sequence=1`부터 시작할 수 있으며,
`caption.segment.final.segmentIndex`는 0부터 증가한다. final은 `lastSequence` 이하 delta를 권위 text로
대체하고 completed는 동일한 `sttSessionId`로 종료 attempt를 명시한다.

Redis endpoint는 런타임 URL로 주입한다. 기본 stream key는 `ai:captions:live`이며 XADD는
기본 `MAXLEN ~ 10000`으로 근사 trimming하면서 직접 await한다. 쓰기 오류와 timeout은 호출자에게
전파된다.

상태 callback 서명 문자열은 다음과 같다.

```text
v1=hex(HMAC-SHA256(secret, timestamp + "." + rawBody))
```

한 event의 제한된 재시도 동안 `eventId`, timestamp, raw body, 서명 header를 모두 그대로
재사용한다. 이 client는 terminal 상태를 준비한 뒤 반대 terminal event를 새로 만들지 않는다.
`fixtures/live-agent-status-signing.valid.json`은 Java 구현과 byte-level 결과를 대조할 수 있는
고정 signing vector다.

## 폴더별 문서

- [`schemas/`](schemas/README.md): 통신별 JSON Schema와 필드 형식
- [`fixtures/`](fixtures/README.md): 정상 payload와 HMAC 서명 검증용 고정 예시
