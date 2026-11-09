package com.liveclass.notification.push;

import org.bouncycastle.jce.provider.BouncyCastleProvider;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Security;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPrivateKeySpec;
import java.security.spec.ECPublicKeySpec;
import java.util.Arrays;
import java.util.Base64;

/**
 * Web Push 발신자 측 암호화(RFC 8291)와 VAPID 서명(RFC 8292).
 *
 * <p>라이브러리(`nl.martijndwars:web-push`) 대신 직접 구현한다. 라이브러리는 기기 하나에
 * 5.95ms가 들고, 실제 암호 연산에 필요한 시간은 0.9ms다. 나머지 비용을 실측으로 쪼갠 결과다
 * (운영 장비 4코어 기준).
 *
 * <pre>
 *   verifyKeyPair    1.83ms   키쌍은 바뀌지 않는데 호출마다 다시 검사한다
 *   임시 키쌍 생성    1.44ms   이름 곡선 경로를 쓰면 0.27ms(아래 참고)
 *   ECDH             2.24ms   이름 곡선 경로를 쓰면 0.34ms
 *   나머지           ~0.4ms
 * </pre>
 *
 * <p>키 생성 방식에 따라 5~7배 차이가 난다. 라이브러리는
 * {@code ECNamedCurveTable.getParameterSpec("prime256v1")}이 준 스펙으로 키를 만들고, 이 경우
 * BouncyCastle은 일반 경로를 탄다. {@code ECGenParameterSpec("secp256r1")}으로 만들면 최적화된
 * 이름 곡선 경로를 탄다. 같은 곡선이고 수학도 같은데 생성은 5.3배, ECDH는 6.7배 차이가 난다.
 *
 * <p>CPU가 발송 처리량의 상한이라(부하 중 사용률 93.5%, 유휴 1.1%) 이 차이가 처리량에 그대로 반영된다.
 *
 * <p>도구는 스레드마다 따로 둔다. {@code Cipher}·{@code KeyAgreement}·{@code Mac}·
 * {@code Signature}·{@code KeyPairGenerator}는 상태를 가지며 스레드 안전하지 않다. 공유하면
 * 오류 없이 결과가 깨진다. 호출마다 새로 만드는 방법도 있지만(라이브러리가 그렇게 한다) 곡선
 * 초기화 비용이 크므로 스레드마다 한 번만 만들어 재사용한다.
 */
final class WebPushCrypto {

    static {
        Security.addProvider(new BouncyCastleProvider());
    }

    private static final String PROVIDER = BouncyCastleProvider.PROVIDER_NAME;
    private static final String CURVE = "secp256r1";
    /** 압축하지 않은 P-256 점: {@code 0x04 ‖ X(32) ‖ Y(32)}. */
    private static final int UNCOMPRESSED_POINT_LENGTH = 65;
    private static final int COORDINATE_LENGTH = 32;
    private static final byte UNCOMPRESSED_TAG = 0x04;

    private static final byte[] WEB_PUSH_INFO = "WebPush: info\0".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] CEK_INFO =
            "Content-Encoding: aes128gcm\0".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] NONCE_INFO =
            "Content-Encoding: nonce\0".getBytes(StandardCharsets.US_ASCII);
    /** 마지막 레코드임을 알리는 구분자. 받는 쪽이 이걸 벗겨야 평문이 나온다. */
    private static final byte LAST_RECORD = 0x02;
    /** 본문 헤더에 적는 레코드 크기. 우리는 항상 한 레코드로 보낸다. */
    private static final int RECORD_SIZE = 4096;

    /*
     * 스레드마다 하나씩. 곡선 초기화 비용이 크므로 매번 만들지 않는다.
     */
    private static final ThreadLocal<KeyPairGenerator> KEY_PAIRS = ThreadLocal.withInitial(() -> {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC", PROVIDER);
            // 이름 곡선(ECGenParameterSpec)으로 초기화한다. 스펙 객체를 직접 넘기면 5배 느려진다.
            generator.initialize(new ECGenParameterSpec(CURVE), new SecureRandom());
            return generator;
        } catch (Exception e) {
            throw new IllegalStateException("EC 키 생성기를 만들지 못했습니다.", e);
        }
    });
    private static final ThreadLocal<KeyAgreement> AGREEMENTS = threadLocal(
            () -> KeyAgreement.getInstance("ECDH", PROVIDER), "ECDH");
    private static final ThreadLocal<Cipher> CIPHERS = threadLocal(
            () -> Cipher.getInstance("AES/GCM/NoPadding", PROVIDER), "AES-GCM");
    private static final ThreadLocal<Mac> MACS = threadLocal(
            () -> Mac.getInstance("HmacSHA256", PROVIDER), "HMAC");
    private static final ThreadLocal<Signature> SIGNATURES = threadLocal(
            () -> Signature.getInstance("SHA256withECDSA", PROVIDER), "ES256");
    private static final ThreadLocal<SecureRandom> RANDOMS =
            ThreadLocal.withInitial(SecureRandom::new);

    private WebPushCrypto() {
    }

    /**
     * 본문을 암호화한다(RFC 8291).
     *
     * <p>임시 키쌍과 salt는 메시지마다 새로 만든다. 규격이 요구한다. 같은 키와 salt를
     * 다시 쓰면 AES-GCM의 nonce가 재사용되어 암호가 통째로 깨진다.
     *
     * @return {@code salt(16) ‖ rs(4) ‖ idlen(1) ‖ 임시공개키(65) ‖ 암호문}
     */
    static byte[] encrypt(byte[] payload, byte[] receiverPublic, byte[] authSecret) {
        try {
            byte[] salt = new byte[16];
            RANDOMS.get().nextBytes(salt);

            KeyPair ephemeral = KEY_PAIRS.get().generateKeyPair();
            byte[] senderPublic = encodePoint((ECPublicKey) ephemeral.getPublic());

            KeyAgreement agreement = AGREEMENTS.get();
            agreement.init(ephemeral.getPrivate());
            agreement.doPhase(decodePoint(receiverPublic), true);
            byte[] sharedSecret = agreement.generateSecret();

            byte[] ikm = hkdf(authSecret, sharedSecret,
                    concat(WEB_PUSH_INFO, receiverPublic, senderPublic), 32);
            byte[] contentKey = hkdf(salt, ikm, CEK_INFO, 16);
            byte[] nonce = hkdf(salt, ikm, NONCE_INFO, 12);

            // 평문 뒤에 구분자를 붙인다. 패딩은 넣지 않는다. 길이를 감출 이유가 없다.
            byte[] plaintext = Arrays.copyOf(payload, payload.length + 1);
            plaintext[payload.length] = LAST_RECORD;

            Cipher cipher = CIPHERS.get();
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(contentKey, "AES"),
                    new GCMParameterSpec(128, nonce));
            byte[] ciphertext = cipher.doFinal(plaintext);

            return ByteBuffer.allocate(16 + 4 + 1 + senderPublic.length + ciphertext.length)
                    .put(salt)
                    .putInt(RECORD_SIZE)
                    .put((byte) senderPublic.length)
                    .put(senderPublic)
                    .put(ciphertext)
                    .array();
        } catch (IllegalArgumentException e) {
            /*
             * 구독 키가 잘못된 것이다. 감싸면 "어느 값이 왜 잘못됐는지"가 로그에서 사라져,
             * 기기 하나 때문에 전체를 뒤지게 된다. 그대로 올린다.
             */
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("푸시 본문 암호화 실패", e);
        }
    }

    /**
     * VAPID 인증 헤더 값(RFC 8292). {@code vapid t=<JWT>, k=<공개키>} 형태다.
     *
     * <p>JWT는 오리진마다 하나면 되고 만료까지 재사용할 수 있다. 부르는 쪽이 캐시한다.
     *
     * @param audience 엔드포인트의 오리진({@code https://fcm.googleapis.com}). 경로가 붙으면 거부된다.
     */
    static String vapidAuthorization(String audience, String subject,
                                     PrivateKey privateKey, byte[] publicKey, long expiresAtEpochSeconds) {
        String header = base64Url("{\"typ\":\"JWT\",\"alg\":\"ES256\"}".getBytes(StandardCharsets.UTF_8));
        String claims = base64Url(("{\"aud\":\"" + audience + "\",\"exp\":" + expiresAtEpochSeconds
                + ",\"sub\":\"" + subject + "\"}").getBytes(StandardCharsets.UTF_8));
        String signingInput = header + '.' + claims;
        try {
            Signature signature = SIGNATURES.get();
            signature.initSign(privateKey);
            signature.update(signingInput.getBytes(StandardCharsets.US_ASCII));
            String jwt = signingInput + '.' + base64Url(toJoseSignature(signature.sign()));
            return "vapid t=" + jwt + ", k=" + base64Url(publicKey);
        } catch (Exception e) {
            throw new IllegalStateException("VAPID 서명 실패", e);
        }
    }

    /**
     * JDK의 ECDSA 서명은 DER이고 JOSE는 raw {@code R‖S} 64바이트를 요구한다.
     *
     * <p>변환하지 않으면 푸시 서비스가 서명을 거부한다. 이 실패는 401/403으로 오므로
     * 암호문 쪽을 아무리 봐도 원인이 보이지 않는다.
     */
    private static byte[] toJoseSignature(byte[] der) {
        // DER: 30 <len> 02 <rlen> R 02 <slen> S
        int index = der[1] == 0x81 ? 3 : 2;
        int rLength = der[index + 1];
        BigInteger r = new BigInteger(Arrays.copyOfRange(der, index + 2, index + 2 + rLength));
        int sOffset = index + 2 + rLength;
        int sLength = der[sOffset + 1];
        BigInteger s = new BigInteger(Arrays.copyOfRange(der, sOffset + 2, sOffset + 2 + sLength));

        byte[] jose = new byte[64];
        copyUnsigned(r, jose, 0);
        copyUnsigned(s, jose, COORDINATE_LENGTH);
        return jose;
    }

    /** 양수 32바이트로 왼쪽 0 채움. {@code BigInteger}는 부호 바이트를 앞에 붙일 수 있다. */
    private static void copyUnsigned(BigInteger value, byte[] target, int offset) {
        byte[] bytes = value.toByteArray();
        int from = Math.max(0, bytes.length - COORDINATE_LENGTH);
        int length = bytes.length - from;
        System.arraycopy(bytes, from, target, offset + COORDINATE_LENGTH - length, length);
    }

    // ---- 키 다루기 ----

    /** base64url로 온 구독 공개키를 {@code PublicKey}로. 압축하지 않은 점만 받는다. */
    static PublicKey decodePoint(byte[] uncompressed) {
        if (uncompressed.length != UNCOMPRESSED_POINT_LENGTH || uncompressed[0] != UNCOMPRESSED_TAG) {
            throw new IllegalArgumentException(
                    "P-256 비압축 점이 아닙니다: " + uncompressed.length + "바이트");
        }
        try {
            BigInteger x = new BigInteger(1, Arrays.copyOfRange(uncompressed, 1, 33));
            BigInteger y = new BigInteger(1, Arrays.copyOfRange(uncompressed, 33, 65));
            return KeyFactory.getInstance("EC", PROVIDER)
                    .generatePublic(new ECPublicKeySpec(new ECPoint(x, y), namedCurve()));
        } catch (Exception e) {
            throw new IllegalArgumentException("구독 공개키를 읽지 못했습니다.", e);
        }
    }

    static byte[] encodePoint(ECPublicKey key) {
        byte[] encoded = new byte[UNCOMPRESSED_POINT_LENGTH];
        encoded[0] = UNCOMPRESSED_TAG;
        copyUnsigned(key.getW().getAffineX(), encoded, 1);
        copyUnsigned(key.getW().getAffineY(), encoded, 1 + COORDINATE_LENGTH);
        return encoded;
    }

    /** VAPID 개인키(base64url 스칼라)를 {@code PrivateKey}로. */
    static PrivateKey decodePrivateKey(byte[] scalar) {
        try {
            return KeyFactory.getInstance("EC", PROVIDER)
                    .generatePrivate(new ECPrivateKeySpec(new BigInteger(1, scalar), namedCurve()));
        } catch (Exception e) {
            throw new IllegalArgumentException("VAPID 개인키를 읽지 못했습니다.", e);
        }
    }

    /**
     * 곡선 파라미터. 한 번만 만들어 재사용한다. 매번 만들면 비용이 크고, 키마다 다른
     * 곡선 객체를 쓰면 BouncyCastle의 사전계산이 매번 빗나간다.
     */
    private static ECParameterSpec namedCurve() {
        return NamedCurve.SPEC;
    }

    /** 지연 초기화 홀더, 곡선 파라미터를 얻으려면 키쌍을 한 번 만들어야 한다. */
    private static final class NamedCurve {
        static final ECParameterSpec SPEC;

        static {
            try {
                KeyPairGenerator generator = KeyPairGenerator.getInstance("EC", PROVIDER);
                generator.initialize(new ECGenParameterSpec(CURVE), new SecureRandom());
                SPEC = ((ECPublicKey) generator.generateKeyPair().getPublic()).getParams();
            } catch (Exception e) {
                throw new IllegalStateException("P-256 곡선 파라미터를 얻지 못했습니다.", e);
            }
        }
    }

    // ---- 도구 ----

    /** HKDF-SHA256(RFC 5869). 뽑는 길이가 32바이트 이하라 확장 한 바퀴면 된다. */
    private static byte[] hkdf(byte[] salt, byte[] ikm, byte[] info, int length) throws Exception {
        Mac mac = MACS.get();
        mac.init(new SecretKeySpec(salt, "HmacSHA256"));
        byte[] pseudoRandomKey = mac.doFinal(ikm);

        mac.init(new SecretKeySpec(pseudoRandomKey, "HmacSHA256"));
        mac.update(info);
        mac.update((byte) 1);
        return Arrays.copyOf(mac.doFinal(), length);
    }

    static byte[] concat(byte[]... parts) {
        int total = 0;
        for (byte[] part : parts) {
            total += part.length;
        }
        ByteBuffer buffer = ByteBuffer.allocate(total);
        for (byte[] part : parts) {
            buffer.put(part);
        }
        return buffer.array();
    }

    static String base64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** 브라우저가 주는 값은 패딩이 없을 수도 있고 있을 수도 있다. */
    static byte[] decodeBase64Url(String value) {
        String trimmed = value.trim();
        int padding = (4 - trimmed.length() % 4) % 4;
        return Base64.getUrlDecoder().decode(trimmed + "=".repeat(padding));
    }

    private interface Factory<T> {
        T create() throws Exception;
    }

    private static <T> ThreadLocal<T> threadLocal(Factory<T> factory, String what) {
        return ThreadLocal.withInitial(() -> {
            try {
                return factory.create();
            } catch (Exception e) {
                throw new IllegalStateException(what + " 준비 실패", e);
            }
        });
    }
}
