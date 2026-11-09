package com.liveclass.notification.push;

import org.bouncycastle.jce.provider.BouncyCastleProvider;

import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.Security;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Web Push 암호화 단건 비용 측정.
 *
 * <p><b>이 숫자 하나가 용량 산정 전체를 지탱한다.</b> 발송 처리량의 상한은 네트워크가 아니라
 * 이 연산이고(구독 1건당 1회, Web Push에 배치가 없다), 여기서 나온 건당 비용으로
 * "100만 명을 1분 안에 보내려면 코어가 몇 개 필요한가"를 역산한다.
 *
 * <p>측정 대상은 {@link WebPushCrypto#encrypt}다 — 임시 EC 키쌍 생성 + ECDH + HKDF 3회 +
 * AES-128-GCM. VAPID 서명은 오리진당 토큰 하나를 캐시해 재사용하므로 건당 비용에 들지 않는다.
 *
 * <p><b>키를 여러 개 쓴다.</b> 같은 구독 키를 반복하면 JIT와 캐시가 실제보다 유리하게 돈다.
 * 실제 부하는 기기마다 키가 다르므로 기본 1,000개를 순회한다.
 *
 * <p><b>스레드마다 도구가 따로다.</b> {@code WebPushCrypto}가 {@code Cipher}·{@code KeyAgreement}·
 * {@code KeyPairGenerator}를 {@code ThreadLocal}로 들고 있어, 스레드 수를 늘리면 그만큼 초기화가
 * 일어난다. 그 비용이 측정에 섞이지 않도록 워밍업이 스레드별로 돈다.
 *
 * <p><b>실행</b>
 * <pre>
 *   ./gradlew :benchDist
 *   java -cp 'build/bench/*:build/bench/lib/*' \
 *        com.liveclass.notification.push.CryptoBench --threads 1 --iterations 200000
 * </pre>
 *
 * <p><b>BouncyCastle을 fat jar로 말면 안 된다.</b> 서명된 JCE 프로바이더라 재포장하면 서명이
 * 깨지고 {@code JCE cannot authenticate the provider BC}로 죽는다. 그래서 {@code benchDist}가
 * 의존성을 {@code lib/}에 원본 그대로 복사한다.
 */
public final class CryptoBench {

    /** 운영과 같은 모양의 페이로드. 길이가 AES-GCM 비용에 들어가므로 실제 문구 길이를 쓴다. */
    private static final byte[] PAYLOAD = PushPayload
            .json("새 강의 자료", "«알고리즘»에 새 자료 «3주차.pptx»가 올라왔습니다.", null)
            .getBytes(StandardCharsets.UTF_8);

    private CryptoBench() {
    }

    public static void main(String[] args) throws Exception {
        int threads = intArg(args, "--threads", 1);
        int warmup = intArg(args, "--warmup", 20_000);
        int iterations = intArg(args, "--iterations", 100_000);
        int keys = intArg(args, "--keys", 1_000);
        String label = stringArg(args, "--label", "crypto");

        Security.addProvider(new BouncyCastleProvider());
        List<Device> devices = devices(keys);

        // 워밍업은 스레드별로 돈다 — ThreadLocal 도구 초기화와 JIT 컴파일을 측정 밖으로 뺀다.
        run(threads, warmup, devices, false);

        long gcCountBefore = gcCount();
        long gcTimeBefore = gcTimeMillis();
        long startedAt = System.nanoTime();
        long[][] perThread = run(threads, iterations, devices, true);
        long wallNanos = System.nanoTime() - startedAt;
        long gcCountAfter = gcCount();
        long gcTimeAfter = gcTimeMillis();

        long[] all = merge(perThread);
        Arrays.sort(all);

        long total = (long) threads * iterations;
        double wallSeconds = wallNanos / 1e9;
        double throughput = total / wallSeconds;

        System.out.printf("""
                {
                  "label": "%s",
                  "jvm": "%s",
                  "availableProcessors": %d,
                  "threads": %d,
                  "warmupPerThread": %d,
                  "iterationsPerThread": %d,
                  "distinctKeys": %d,
                  "payloadBytes": %d,
                  "totalCalls": %d,
                  "wallSeconds": %.3f,
                  "throughputPerSecond": %.1f,
                  "perCallMillis": { "p50": %.4f, "p95": %.4f, "p99": %.4f, "min": %.4f, "max": %.4f, "mean": %.4f },
                  "gc": { "collections": %d, "millis": %d }
                }
                %n""",
                label,
                System.getProperty("java.vm.version"),
                Runtime.getRuntime().availableProcessors(),
                threads, warmup, iterations, keys, PAYLOAD.length,
                total, wallSeconds, throughput,
                ms(percentile(all, 0.50)), ms(percentile(all, 0.95)), ms(percentile(all, 0.99)),
                ms(all[0]), ms(all[all.length - 1]), ms(mean(all)),
                gcCountAfter - gcCountBefore, gcTimeAfter - gcTimeBefore);

        /*
         * GC가 측정 구간에 돌았으면 꼬리(p99)가 그것 때문일 수 있다. 판정을 사람에게 맡기지 않고
         * 표준 에러로 경고를 남긴다 — 결과 파일을 나중에 볼 때 조건을 잊지 않게.
         */
        if (gcCountAfter > gcCountBefore) {
            System.err.printf("경고: 측정 구간에 GC가 %d회 돌았다(%dms). p99를 신뢰하기 전에 힙을 키워 재실행하라.%n",
                    gcCountAfter - gcCountBefore, gcTimeAfter - gcTimeBefore);
        }
    }

    /**
     * 스레드 {@code threads}개가 각각 {@code iterations}회 호출한다.
     *
     * @param record {@code false}면 워밍업이라 시간을 담지 않는다.
     * @return 스레드별 호출 시간(ns). {@code record}가 false면 빈 배열.
     */
    private static long[][] run(int threads, int iterations, List<Device> devices, boolean record)
            throws InterruptedException {
        long[][] samples = new long[threads][];
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch go = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads);

        for (int t = 0; t < threads; t++) {
            final int index = t;
            Thread thread = new Thread(() -> {
                long[] mine = record ? new long[iterations] : null;
                ready.countDown();
                try {
                    go.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
                /*
                 * 스레드마다 다른 키에서 시작한다. 전부 0번부터 돌면 같은 키를 동시에 만져
                 * 캐시가 실제보다 유리해진다.
                 */
                int cursor = index * 37;
                for (int i = 0; i < iterations; i++) {
                    Device device = devices.get(Math.floorMod(cursor++, devices.size()));
                    long at = System.nanoTime();
                    byte[] body = WebPushCrypto.encrypt(PAYLOAD, device.receiverPublic(), device.authSecret());
                    long elapsed = System.nanoTime() - at;
                    if (mine != null) {
                        mine[i] = elapsed;
                    }
                    // JIT가 결과를 안 쓰는 호출로 보고 지우지 않게 붙잡아 둔다.
                    if (body.length == 0) {
                        throw new IllegalStateException("빈 암호문");
                    }
                }
                samples[index] = mine;
                done.countDown();
            }, "crypto-bench-" + t);
            thread.start();
        }

        ready.await();
        go.countDown();
        done.await();
        return samples;
    }

    /** 기기마다 키가 다르다. 운영과 같은 방식({@code ECGenParameterSpec})으로 만든다. */
    private static List<Device> devices(int count) throws Exception {
        KeyPairGenerator generator =
                KeyPairGenerator.getInstance("EC", BouncyCastleProvider.PROVIDER_NAME);
        generator.initialize(new ECGenParameterSpec("secp256r1"), new SecureRandom());
        SecureRandom random = new SecureRandom();

        List<Device> devices = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            KeyPair pair = generator.generateKeyPair();
            byte[] auth = new byte[16];
            random.nextBytes(auth);
            devices.add(new Device(WebPushCrypto.encodePoint((ECPublicKey) pair.getPublic()), auth));
        }
        return devices;
    }

    private record Device(byte[] receiverPublic, byte[] authSecret) {
    }

    // ---- 통계 ----

    private static long[] merge(long[][] perThread) {
        int total = 0;
        for (long[] thread : perThread) {
            total += thread.length;
        }
        long[] all = new long[total];
        int at = 0;
        for (long[] thread : perThread) {
            System.arraycopy(thread, 0, all, at, thread.length);
            at += thread.length;
        }
        return all;
    }

    /** 정렬된 배열에서의 백분위. 보간하지 않는다 — 표본이 수만 개라 차이가 없다. */
    private static long percentile(long[] sorted, double fraction) {
        int index = (int) Math.round(fraction * (sorted.length - 1));
        return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
    }

    private static double mean(long[] values) {
        double sum = 0;
        for (long value : values) {
            sum += value;
        }
        return sum / values.length;
    }

    private static double ms(double nanos) {
        return nanos / 1_000_000d;
    }

    private static long gcCount() {
        long count = 0;
        for (GarbageCollectorMXBean bean : ManagementFactory.getGarbageCollectorMXBeans()) {
            long value = bean.getCollectionCount();
            if (value > 0) {
                count += value;
            }
        }
        return count;
    }

    private static long gcTimeMillis() {
        long millis = 0;
        for (GarbageCollectorMXBean bean : ManagementFactory.getGarbageCollectorMXBeans()) {
            long value = bean.getCollectionTime();
            if (value > 0) {
                millis += value;
            }
        }
        return millis;
    }

    // ---- 인자 ----

    private static int intArg(String[] args, String name, int fallback) {
        String value = stringArg(args, name, null);
        return value == null ? fallback : Integer.parseInt(value);
    }

    private static String stringArg(String[] args, String name, String fallback) {
        for (int i = 0; i < args.length - 1; i++) {
            if (args[i].equals(name)) {
                return args[i + 1];
            }
        }
        return fallback;
    }

    static {
        // 시간 단위를 눈에 띄게 고정해 둔다. 이 값이 바뀌면 위 통계가 전부 어긋난다.
        assert TimeUnit.MILLISECONDS.toNanos(1) == 1_000_000L;
    }
}
