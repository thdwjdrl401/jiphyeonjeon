# ADR-0133: 알림 리스너는 될 수 있는 실패만 다시 하고, DLQ는 경보를 낸다

- **상태**: 채택 — 코드·테스트 반영, 경보 규칙은 벤치 스택에만 적용(운영 전개는 미실시)
- **일자**: 2026-08-20
- **관련**: [0131](0131-the-next-slice-goes-out-before-the-app-work.md)(이 ADR이 그 "남아 있는 문제"를 닫는다),
  [0128](0128-a-throttled-push-is-not-a-delivered-push.md)(기기 단위 재시도),
  [0127](0127-push-worker-node-role-split.md)(발송 노드 분리),
  [0124](0124-push-delivery-queue-and-progress.md)(푸시 전용 큐),
  [0073](0073-notification-fanout-architecture.md)(팬아웃 설계)
- **적용 범위**: `NotificationMessagingConfig`, `application.yml`,
  `infra/prometheus/notification-dlq.rules.yml`, `bench/monitoring/prometheus*.yml`,
  `bench/compose.bench.yml`, `bench/monitoring/compose.remote.yml`,
  `NotificationListenerRetryTest`

## 한 줄 결정

두 알림 리스너 팩토리에만 재시도 인터셉터를 걸고, 다시 해도 결과가 같은 예외는 분류기로 걸러
곧바로 DLQ로 보낸다. DLQ 깊이 경보는 앱이 아니라 RabbitMQ가 이미 내보내는 지표에 건다.

## 계기

ADR-0131이 남긴 두 항목이다. 그 문서 말미에 "팬아웃 리스너에 재시도 인터셉터가 없어 첫 실패가 곧
DLQ이고 DLQ 경보도 없다 — 그 둘은 남아 있는 문제다"라고 적혀 있다.

## 확인한 사실 — 문서와 코드가 어긋나 있었다

`notificationListenerContainerFactory`의 javadoc은 "전역 설정을 건드리지 않고 이 리스너에만 규칙을
준다 — 재시도 3회 뒤 포기하고 DLQ로"라고 적고 있었다. 그런데 팩토리가 실제로 하는 설정은 둘뿐이다.

```java
configurer.configure(factory, connectionFactory);
factory.setDefaultRequeueRejected(false);
factory.setConcurrentConsumers(concurrency);
```

Spring AMQP에서 리스너 재시도를 켜는 경로는 두 가지다. 어드바이스 체인을 직접 거는 것과, 전역
`spring.rabbitmq.listener.simple.retry.*`를 켜서 Boot의 configurer가 대신 걸게 하는 것. 이 코드는
앞엣것을 하지 않았고, `application.yml`의 `spring.rabbitmq.listener.simple` 블록에는 `concurrency`만
있어 `retry` 하위가 없다. Boot 기본값이 `retry.enabled=false`이므로 configurer도 아무것도 걸지
않았다. **첫 실패가 곧 DLQ였다.** 푸시 팩토리도 같은 상태였다.

즉 "재시도 3회"는 한 번도 사실인 적이 없었다. 이 어긋남이 눈에 띄지 않은 이유는 실패했을 때의
동작이 문서와 코드에서 같은 방향이었기 때문이다 — 둘 다 결국 DLQ로 간다. 다른 것은 횟수뿐이고,
횟수는 로그를 세어 보지 않으면 드러나지 않는다.

## 재시도를 이 두 팩토리에만 건다

전역 스위치를 켜지 않는다. 그 스위치는 아웃박스 릴레이를 포함한 모든 리스너에 걸리고, 여기서
정하려는 것은 이 두 큐의 규칙이다. 기존 코드가 소비자 수에 대해 이미 같은 원칙을 지키고
있다(ADR-0131) — 재시도도 같은 자리에 둔다.

`RetryInterceptorBuilder.stateless()`로 어드바이스를 만들어 `factory.setAdviceChain(...)`에 건다.
상태 있는(stateful) 쪽은 메시지 id로 재배달 횟수를 세는 방식인데, 이 큐의 메시지에는 안정적인
message-id가 없어 쓸 수 없다. 상태 없는(stateless) 재시도는 브로커에 되돌리지 않고 소비자 스레드
안에서 리스너를 다시 부른다.

### 값과 근거

| 설정 | 기본값 |
|---|---|
| `notification.{fanout,push}.listener-max-retries` | 3 |
| `notification.{fanout,push}.listener-retry-initial-backoff-ms` | 500 |
| `notification.{fanout,push}.listener-retry-multiplier` | 2.0 |
| `notification.{fanout,push}.listener-retry-max-backoff-ms` | 5000 |

첫 대기가 500ms인 것은 노리는 실패가 커넥션 풀이 잠깐 비는 것 같은 짧은 장애이기 때문이다.
`spring.datasource.hikari.connection-timeout`이 5초이므로, 풀이 비어 실패한 뒤 그보다 짧은 간격으로
다시 오면 이미 자리가 났을 가능성이 있다.

횟수가 3인 것은 두 가지 이유다. 재시도가 소비자 스레드 안에서 도는 방식이라 백오프 동안 그
소비자가 묶이고, 기본값이면 한 메시지가 최대 0.5+1+2 = 3.5초를 잡는다. 팬아웃 소비자가 8이므로 그
사이 1/8이 멈춘다. 그리고 이 저장소가 이미 같은 값을 쓴다 —
`notification.web-push.max-attempts`가 3, `retry-backoff-ms`가 500이다(ADR-0128). 실패를 세는 단위를
하나로 유지한다.

한 번의 대기 상한 5초는 위 hikari 타임아웃과 같은 자릿수다. 기본 횟수에서는 2초에서 끝나 닿지
않고, 횟수를 올렸을 때의 상한 역할을 한다.

값은 실측이 아니라 기존 설정과의 정합에서 나왔다. 재시도가 실제로 도는 빈도를 운영에서 본 뒤
조정할 여지가 있다.

## 결정론적 실패는 가르는 자리를 큐에 둔다

`NotificationFanoutWorker.handle`은 계약에 없는 알림 종류에 `IllegalArgumentException`을 던지고
"재시도해도 같으므로 DLQ로 보낸다"고 적고 있다. 재시도가 생기면 이 메시지도 네 번 돌게 되므로 —
답이 바뀌지 않는데 소비자만 3.5초 묶인다 — 가르는 장치가 필요하다.

**워커에서 `AmqpRejectAndDontRequeueException`으로 감싸지 않고 예외 분류기를 쓴다.** 감싸는 쪽을
고르면 큐 계층의 사정이 업무 코드로 올라온다. 팬아웃 워커는 "알 수 없는 종류다"만 말하면 되고,
그것을 재시도할지는 이 큐가 정할 일이다. 분류기로 가르면 워커를 건드리지 않고, 두 워커에 같은
규칙이 한 곳에서 적용된다.

Spring AMQP 4.1의 `RetryInterceptorBuilder`는 Spring Framework 7의
`org.springframework.core.retry.RetryPolicy`를 받으므로 그 빌더의 `excludes`가 분류기다. 재시도하지
않는 예외는 셋이다.

- `IllegalArgumentException` — 위의 알 수 없는 알림 종류.
- `JacksonException` — 페이로드가 명령 타입으로 파싱되지 않는다. 바이트가 그대로인 한 다음 시도도
  같은 자리에서 실패한다.
- `AmqpRejectAndDontRequeueException` — AMQP에서 "재시도 말고 버려라"의 표준 신호다. 재시도 계층이
  이걸 못 알아보면 그 뜻이 사라진다.

**원인 사슬을 훑어야 한다.** `@RabbitListener` 메서드에서 나온 예외는 리스너 어댑터가
`ListenerExecutionFailedException`으로 감싸므로 맨 바깥 타입만 보면 셋 중 무엇도 걸리지 않는다.
`RetryPolicy.Builder.excludes`가 만드는 필터는 `ExceptionTypeFilter`로 사슬을 따라가며 맞춰 본다.

## recoverer를 반드시 준다

`RetryInterceptorBuilder`에 recoverer를 주지 않으면 소진 시 동작이 **메시지 유실**이다.
`StatelessRetryOperationsInterceptorFactoryBean.recover`가 recoverer가 없을 때 WARN 한 줄을 찍고
`null`을 반환하는데, 컨테이너가 보기엔 정상 종료라 메시지가 ack되고 사라진다. DLQ로 가지 않는다.

`RejectAndDontRequeueRecoverer`를 걸면 대신 `AmqpRejectAndDontRequeueException`을 던져 requeue 없는
reject가 되고, 그 reject가 큐에 걸린 dead-letter 설정을 타고 DLQ로 간다.
`defaultRequeueRejected=false`를 그대로 두는 이유가 여기다 — true면 reject된 메시지가 큐 앞으로
돌아가 그 경로를 타지 않는다.

## DLQ 경보 — 앱이 재지 않는다

**RabbitMQ가 이미 내보내는 지표에 Prometheus 알림 규칙을 건다.** 앱에서 Micrometer 게이지로 DLQ
깊이를 올리는 방법도 있지만 없어도 될 결합이 생긴다 — 발송 전용 노드처럼 그 큐를 안 보는
노드에서도 폴링이 돌고, 앱이 죽은 동안에는 경보도 함께 죽는다. DLQ가 차는 상황과 앱이 이상한
상황은 겹치기 쉬우므로 경보를 앱 밖에 두는 편이 낫다.

지표 이름은 이 저장소가 이미 쓰던 것이다. 벤치 대시보드
(`bench/monitoring/grafana/dashboards/fanout.json`)가 `rabbitmq_queue_messages{queue=~".*dlq"}`로
DLQ 깊이를 그리고 있고, 스크레이프 경로도 이미 `/metrics/per-object`로 잡혀 있다(기본 `/metrics`는
큐별로 안 내보내고 합계만 낸다).

규칙은 둘이다. 대상 큐는 `notification.fanout.dlq`와 `notification.push.dlq`다.

| 규칙 | 조건 | 등급 |
|---|---|---|
| `NotificationDlqHasMessages` | `> 0` 이 2분 | warning |
| `NotificationDlqFillingFast` | `> 100` 이 2분 | critical |

임계값이 1인 이유는 DLQ에 무엇이든 들어왔다는 것이 이미 재시도로 안 되는 실패라는 뜻이기
때문이다. DLQ는 소비자가 없어 저절로 비지 않으므로 `for: 2m`은 스크레이프 한 점이 튀는 것을 거를
뿐이다. 100은 개별 메시지 문제와 구조적 실패를 가르는 선이다 — 넓은 팬아웃이 통째로 실패하면
조각이 줄줄이 들어오고(수강생 100만 명이면 조각 200개), 그건 메시지 하나를 버려 끝나는 일이 아니다.
실측 후 조정한다.

**운영 전개는 미실시다.** 이 규칙 파일을 읽는 Prometheus는 벤치 스택 하나뿐이다.
`docker-compose.prod.yml`에는 Prometheus도 Alertmanager도 없고 RabbitMQ의 15692 포트도 노출돼 있지
않다. 운영에서 켜려면 셋이 필요하고 규칙 파일에 그대로 적어 두었다 — 15692 노출, 그 포트를
`/metrics/per-object`로 스크레이프하며 이 파일을 `rule_files`로 읽는 Prometheus, Alertmanager 수신처.
규칙 본문은 벤치가 아니라 `infra/prometheus/`에 둔다. 벤치 전용 규칙이 아니고, 지금 그것을 읽을 수
있는 Prometheus가 거기 하나일 뿐이다.

## 검증

계약 테스트는 아니다. FE/BE도 Python↔Spring도 이 경계를 넘지 않고 API 필드·상태코드도 바뀌지
않는다(POLICY의 "공유 경계를 넘는가" 기준). 그래도 테스트를 둔 이유는 다른 데 있다 — 이 작업의
요지가 "문서에는 있는데 코드에는 없었다"이므로, 같은 어긋남이 다시 생기지 않게 막는 검사가
필요하다. `NotificationListenerRetryTest` 8건이 그 자리다.

브로커를 띄우지 않는다. 확인할 것은 RabbitMQ의 동작이 아니라 어드바이스의 판단 — 몇 번 다시
부르는가, 언제 그만두는가, 그만둘 때 무엇을 던지는가 — 이고 그 셋은 인터셉터를 직접 불러 볼 수
있다. 컨테이너는 이 어드바이스를 `ContainerDelegate.invokeListener(Channel, Object)`에 걸므로
인수 모양만 맞추면 된다.

| 검사 | 확인한 것 |
|---|---|
| 일시적 실패 | 호출 4회(첫 시도 + 재시도 3) |
| 소진 | `AmqpRejectAndDontRequeueException`을 던진다(조용히 ack되지 않는다) |
| 중간 성공 | 호출 2회에서 멈춘다 |
| 알 수 없는 알림 종류 | 호출 1회 |
| 파싱 실패 | 호출 1회 |
| 명시적 재시도 금지 신호 | 호출 1회 |
| 백오프 | 100·2.0·상한 150 설정에서 실측 437ms(하한 400ms) |
| 팩토리 결선 | 두 팩토리 모두 어드바이스 1개 + `defaultRequeueRejected=false` |

마지막 항목이 이 어긋남을 직접 막는 것이다. 앞의 일곱이 다 통과해도 어드바이스가 팩토리에 걸려
있지 않으면 리스너는 그대로 재시도 없이 돈다 — 고치려던 상태가 정확히 그 모양이었다. 이 검사는
진짜 `SimpleRabbitListenerContainerFactoryConfigurer`를 써서 Boot 기본값을 통과시키므로, 체인이
있다는 것은 우리가 걸었다는 뜻이다.

경보 쪽은 실제 RabbitMQ와 Prometheus를 띄워 확인했다.

- `rabbitmq:3.13-management-alpine`(운영·벤치가 쓰는 이미지)에서 `rabbitmq_prometheus`가 기본으로
  켜져 있다.
- 네 큐를 앱과 같은 인자로 선언하고 `notification.fanout`의 메시지를 requeue 없이 reject하니
  `notification.fanout.dlq`로 넘어갔다.
- `/metrics/per-object`가 `rabbitmq_queue_messages{vhost="/",queue="notification.fanout.dlq"} 1`을
  냈고, 이 규칙 파일을 읽은 Prometheus에서 `NotificationDlqHasMessages`가 그 값으로 발화했다.
- `promtool check rules`와 `check config`가 규칙 파일과 벤치 두 설정 모두 통과.

## 남는 것

운영 관측 스택이다. 규칙은 있지만 운영에서 그것을 평가하는 Prometheus가 없으므로, 운영 DLQ가 차도
지금은 신호가 나가지 않는다. 위 "운영 전개는 미실시" 항목 셋이 그 일이다.
