# Realtime agent v1 contract artifacts

이 디렉터리는 realtime-agent v1 계약의 JSON Schema와 대표 fixture를 보관한다.
Spring이 생산·소비하는 경계는 [`docs/CONTRACT.md` §3-3~§3-5](../../../docs/CONTRACT.md#3-내부-계약-확정-인터페이스)에 채택됐다.
Java producer/consumer와 양쪽 계약 테스트가 아직 없으므로 Java 통합 완료로
간주하지 않는다.

## 경계

| Schema | Producer | Transport | Consumer |
|---|---|---|---|
| `dispatch-metadata.schema.json` | Spring dispatch adapter | LiveKit job metadata | realtime-agent |
| `caption-stream-entry.schema.json` | realtime-agent | Redis Stream | 향후 Spring/ai-api consumer |
| `live-agent-status.schema.json` | realtime-agent | 서명된 내부 HTTP | 향후 Spring callback |

`sessionId`와 `lessonId`는 소문자 canonical UUID 문자열이다. 모든 payload 필드는
`camelCase`이고 알 수 없는 필드는 거부한다.

`streamElapsedMs`는 라이브 세션 생성 시각 기준 시간이 아니다. **realtime-agent가 첫
오디오 프레임을 받은 시점을 0으로 한 단조 증가 시간**이다. 공유 계약으로 승격할 때는
Spring이 가진 세션 clock으로 변환할 기준점 또는 별도 offset 계약을 먼저 확정해야 한다.

caption `sequence`는 `(sessionId, sttSessionId)`로 식별되는 한 job attempt의 STT stream 안에서만
단조 증가한다. 순차 retry는 새 `sttSessionId`로 다시 `sequence=1`부터 시작할 수 있으며,
`caption.stream.completed`도 동일한 `sttSessionId`로 종료할 attempt를 명시한다.

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
