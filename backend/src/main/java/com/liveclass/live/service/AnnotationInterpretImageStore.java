package com.liveclass.live.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 판서 해석 이미지를 <b>모델이 가져갈 동안만</b> 들고 있는 임시 저장소(ADR-0058).
 *
 * <p><b>왜 필요한가.</b> 이미지를 요청 본문에 실으면 GMS 게이트웨이의 본문 한도(~100KB)에 걸린다.
 * 넘으면 본문을 읽지 못하고 {@code "Model not found in request"}라는 크기와 무관해 보이는 오류를
 * 돌려주므로, 판서를 크게 그릴수록 해석이 실패했다. URL을 주면 본문이 수백 바이트로 고정되고
 * 이미지 크기와 무관해진다 — 화질을 깎지 않아도 된다.
 *
 * <p><b>디스크에 남기지 않는다.</b> 이 이미지는 모델이 한 번 읽고 버리는 것이라 저장소에 둘 이유가
 * 없다. 메모리에 두고 호출이 끝나면 지운다 — 정리 작업도, 수명주기 관리도 필요 없다.
 *
 * <p><b>노출 범위.</b> 강의 내용이므로 토큰이 새면 그 판서가 보인다. 그래서 세 겹으로 막는다.
 * <ul>
 *   <li>128비트 난수 토큰 — 추측할 수 없다.</li>
 *   <li>짧은 TTL — 모델이 받아가는 시간만.</li>
 *   <li>호출이 끝나면 즉시 폐기 — 성공이든 실패든.</li>
 * </ul>
 *
 * <p>"한 번 읽으면 폐기"로 하지 않은 이유는 <b>재시도</b>다. 모델 쪽이 이미지를 다시 받아가려 하면
 * 그 시도가 실패해 해석 전체가 무너진다. 대신 위 셋으로 창을 좁힌다.
 */
@Component
public class AnnotationInterpretImageStore {

    private static final Logger log = LoggerFactory.getLogger(AnnotationInterpretImageStore.class);

    /** 모델이 받아가는 데 필요한 시간만. 호출이 끝나면 어차피 즉시 지운다. */
    private static final Duration TTL = Duration.ofMinutes(2);

    /** 새는 것을 막는 마지막 방어. 정상 경로에서는 호출마다 바로 지워져 여기 닿지 않는다. */
    private static final int MAX_ENTRIES = 64;

    private final SecureRandom random = new SecureRandom();
    private final Map<String, Entry> entries = new ConcurrentHashMap<>();

    /** 보관 중인 이미지 하나. */
    public record Entry(byte[] bytes, String mediaType, Instant expiresAt) {
    }

    /**
     * 이미지를 등록하고 조회 토큰을 돌려준다.
     *
     * @return 추측할 수 없는 토큰. 호출자는 끝난 뒤 반드시 {@link #discard(String)} 한다.
     */
    public String publish(byte[] bytes, String mediaType) {
        purgeExpired();
        if (entries.size() >= MAX_ENTRIES) {
            // 여기 닿는다는 것은 discard가 빠진 경로가 있다는 뜻이다. 조용히 넘기지 않는다.
            log.warn("판서 해석 이미지 보관이 상한에 닿았다({}). 정리되지 않는 경로가 있는지 확인이 필요하다.",
                    MAX_ENTRIES);
            purgeOldest();
        }
        byte[] raw = new byte[16];
        random.nextBytes(raw);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        entries.put(token, new Entry(bytes, mediaType, Instant.now().plus(TTL)));
        return token;
    }

    /** 만료되지 않았으면 이미지를 돌려준다. */
    public Optional<Entry> find(String token) {
        Entry entry = entries.get(token);
        if (entry == null) {
            return Optional.empty();
        }
        if (Instant.now().isAfter(entry.expiresAt())) {
            entries.remove(token);
            return Optional.empty();
        }
        return Optional.of(entry);
    }

    /** 호출이 끝나면 부른다. 성공이든 실패든 남겨 둘 이유가 없다. */
    public void discard(String token) {
        entries.remove(token);
    }

    private void purgeExpired() {
        Instant now = Instant.now();
        entries.entrySet().removeIf(e -> now.isAfter(e.getValue().expiresAt()));
    }

    private void purgeOldest() {
        entries.entrySet().stream()
                .min(Map.Entry.comparingByValue(java.util.Comparator.comparing(Entry::expiresAt)))
                .ifPresent(oldest -> entries.remove(oldest.getKey()));
    }
}
