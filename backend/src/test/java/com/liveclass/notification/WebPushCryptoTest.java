package com.liveclass.notification;

import com.liveclass.notification.push.PushSubscription;
import com.liveclass.notification.push.WebPushProperties;
import com.liveclass.notification.push.WebPushTestAccess;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.Test;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.Security;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 우리가 만든 암호문을 <b>실제로 풀어 본다</b>.
 *
 * <p>라이브러리를 걷어냈으므로 이제 RFC 8291·8292가 우리 책임이다. 그리고 이 층의 실패는
 * <b>조용하다</b> — 푸시 서비스는 암호문을 들여다보지 않으므로 틀려도 201을 준다. 운영에서
 * "FCM은 2xx인데 알림이 안 뜬다"를 몇 시간 쫓았던 것이 정확히 그 구간이다.
 *
 * <p>그래서 여기서는 <b>수신자 노릇</b>을 한다 — 구독 개인키로 직접 복호화해 평문을 견주고,
 * VAPID JWT를 공개키로 검증한다. 브라우저가 하는 일을 그대로 한다.
 */
class WebPushCryptoTest {

    static {
        Security.addProvider(new BouncyCastleProvider());
    }

    private static final String SUBJECT = "mailto:liveclass@example.com";

    @Test
    void the_body_we_encrypt_can_actually_be_decrypted_by_the_subscription() throws Exception {
        Device device = Device.create();
        WebPushProperties vapid = newVapidKeys();
        String plaintext = "{\"title\":\"곧 시작\",\"body\":\"스프링 부트 3회차\",\"url\":\"/notifications\"}";

        var request = WebPushTestAccess.create(vapid, device.subscription(),
                plaintext.getBytes(StandardCharsets.UTF_8));

        assertThat(device.decrypt(request.body()))
                .as("여기서 어긋나면 푸시 서비스는 2xx를 주고 기기만 조용히 못 읽는다")
                .isEqualTo(plaintext);
    }

    /** 같은 내용을 두 번 보내도 <b>암호문이 달라야</b> 한다. 같으면 salt나 임시키를 재사용한 것이다. */
    @Test
    void every_message_gets_a_fresh_salt_and_ephemeral_key() throws Exception {
        Device device = Device.create();
        WebPushProperties vapid = newVapidKeys();
        byte[] payload = "같은 내용".getBytes(StandardCharsets.UTF_8);

        byte[] first = WebPushTestAccess.create(vapid, device.subscription(), payload).body();
        byte[] second = WebPushTestAccess.create(vapid, device.subscription(), payload).body();

        assertThat(Arrays.copyOfRange(first, 0, 16))
                .as("salt를 재사용하면 같은 키·nonce로 두 번 암호화하게 되어 암호가 깨진다")
                .isNotEqualTo(Arrays.copyOfRange(second, 0, 16));
        assertThat(Arrays.copyOfRange(first, 21, 86))
                .as("임시 공개키도 메시지마다 새로 만들어야 한다 (RFC 8291)")
                .isNotEqualTo(Arrays.copyOfRange(second, 21, 86));
        // 그래도 둘 다 풀려야 한다.
        assertThat(device.decrypt(first)).isEqualTo(device.decrypt(second));
    }

    /**
     * VAPID JWT가 <b>공개키로 검증</b>되고 대상·만료가 규격에 맞는가.
     *
     * <p>서명을 DER 그대로 두면 여기서 깨진다 — JOSE는 raw {@code R‖S}를 요구한다.
     */
    @Test
    void the_vapid_token_verifies_against_our_public_key() throws Exception {
        Device device = Device.create();
        WebPushProperties vapid = newVapidKeys();

        String authorization = WebPushTestAccess.create(vapid, device.subscription(),
                "본문".getBytes(StandardCharsets.UTF_8)).headers().get("Authorization");

        assertThat(authorization).startsWith("vapid t=");
        String token = authorization.substring("vapid t=".length(), authorization.indexOf(", k="));
        String key = authorization.substring(authorization.indexOf(", k=") + 4);

        assertThat(key)
                .as("서명에 쓴 키를 함께 보내야 푸시 서비스가 검증할 수 있다")
                .isEqualTo(vapid.publicKey());

        JsonWebSignature jws = new JsonWebSignature();
        jws.setCompactSerialization(token);
        jws.setKey(publicKeyOf(decode(key)));
        assertThat(jws.verifySignature())
                .as("DER 서명을 raw R‖S로 안 바꾸면 여기서 깨진다")
                .isTrue();

        JwtClaims claims = JwtClaims.parse(jws.getUnverifiedPayload());
        assertThat(claims.getAudience()).containsExactly("https://push.example");
        assertThat(claims.getSubject()).isEqualTo(SUBJECT);
        assertThat(claims.getExpirationTime().getValueInMillis())
                .as("RFC 8292는 24시간 이내를 요구한다")
                .isLessThan(System.currentTimeMillis() + 24 * 3600_000L);
    }

    /** 대상은 <b>오리진</b>이어야 한다. 경로가 붙으면 푸시 서비스가 거부한다. */
    @Test
    void the_audience_is_the_origin_without_the_path() throws Exception {
        Device device = Device.create("https://fcm.googleapis.com/fcm/send/abc123");
        WebPushProperties vapid = newVapidKeys();

        String authorization = WebPushTestAccess.create(vapid, device.subscription(),
                "본문".getBytes(StandardCharsets.UTF_8)).headers().get("Authorization");
        String token = authorization.substring("vapid t=".length(), authorization.indexOf(", k="));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setCompactSerialization(token);

        assertThat(JwtClaims.parse(jws.getUnverifiedPayload()).getAudience())
                .containsExactly("https://fcm.googleapis.com");
    }

    /** 푸시 서비스가 요구하는 헤더가 전부 있는가. 하나라도 빠지면 400이거나 조용히 안 뜬다. */
    @Test
    void the_required_headers_are_present() throws Exception {
        Device device = Device.create();
        Map<String, String> headers = WebPushTestAccess.create(newVapidKeys(), device.subscription(),
                "본문".getBytes(StandardCharsets.UTF_8)).headers();

        assertThat(headers).containsEntry("Content-Encoding", "aes128gcm")
                .containsEntry("Content-Type", "application/octet-stream")
                .containsKey("TTL")
                .containsKey("Authorization");
    }

    /** 구독 키가 깨졌으면 <b>기동이 아니라 그 기기에서</b> 터져야 한다 — 나머지는 계속 보낸다. */
    @Test
    void a_malformed_subscription_key_is_rejected_clearly() {
        Device device = Device.create();
        PushSubscription broken = device.subscription();
        broken.setP256dh(WebPushTestAccess.base64Url(new byte[]{1, 2, 3}));

        assertThatThrownBy(() -> WebPushTestAccess.create(newVapidKeys(), broken,
                "본문".getBytes(StandardCharsets.UTF_8)))
                .as("무엇이 왜 잘못됐는지가 메시지에 있어야 기기 하나 때문에 전체를 뒤지지 않는다")
                .hasMessageContaining("P-256");
    }

    // ---- 브라우저 노릇 ----

    /** 구독 하나. 개인키를 쥐고 있으므로 <b>실제로 복호화할 수 있다</b>. */
    private record Device(KeyPair keyPair, byte[] auth, String endpoint) {

        static Device create() {
            return create("https://push.example/send/" + UUID.randomUUID());
        }

        static Device create(String endpoint) {
            try {
                KeyPairGenerator generator = KeyPairGenerator.getInstance("EC", "BC");
                generator.initialize(new ECGenParameterSpec("secp256r1"), new SecureRandom());
                byte[] auth = new byte[16];
                new SecureRandom().nextBytes(auth);
                return new Device(generator.generateKeyPair(), auth, endpoint);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }

        PushSubscription subscription() {
            PushSubscription subscription = new PushSubscription();
            subscription.setId(UUID.randomUUID());
            subscription.setUserId(UUID.randomUUID());
            subscription.setEndpoint(endpoint);
            subscription.setP256dh(WebPushTestAccess.base64Url(
                    encodePoint((ECPublicKey) keyPair.getPublic())));
            subscription.setAuth(WebPushTestAccess.base64Url(auth));
            return subscription;
        }

        /** RFC 8291 수신자 측. 브라우저가 하는 일 그대로다. */
        String decrypt(byte[] body) throws Exception {
            byte[] salt = Arrays.copyOfRange(body, 0, 16);
            int keyIdLength = body[20] & 0xFF;
            byte[] senderPublic = Arrays.copyOfRange(body, 21, 21 + keyIdLength);
            byte[] ciphertext = Arrays.copyOfRange(body, 21 + keyIdLength, body.length);

            KeyAgreement agreement = KeyAgreement.getInstance("ECDH", "BC");
            agreement.init(keyPair.getPrivate());
            agreement.doPhase(publicKeyOf(senderPublic), true);
            byte[] shared = agreement.generateSecret();

            byte[] receiverPublic = encodePoint((ECPublicKey) keyPair.getPublic());
            byte[] ikm = hkdf(auth, shared, concat(
                    "WebPush: info\0".getBytes(StandardCharsets.US_ASCII),
                    receiverPublic, senderPublic), 32);
            byte[] cek = hkdf(salt, ikm,
                    "Content-Encoding: aes128gcm\0".getBytes(StandardCharsets.US_ASCII), 16);
            byte[] nonce = hkdf(salt, ikm,
                    "Content-Encoding: nonce\0".getBytes(StandardCharsets.US_ASCII), 12);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding", "BC");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cek, "AES"),
                    new GCMParameterSpec(128, nonce));
            byte[] padded = cipher.doFinal(ciphertext);

            int end = padded.length;
            while (end > 0 && padded[end - 1] == 0) {
                end--;
            }
            if (end > 0 && (padded[end - 1] == 0x02 || padded[end - 1] == 0x01)) {
                end--;
            }
            return new String(padded, 0, end, StandardCharsets.UTF_8);
        }
    }

    private static WebPushProperties newVapidKeys() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC", "BC");
        generator.initialize(new ECGenParameterSpec("secp256r1"), new SecureRandom());
        KeyPair pair = generator.generateKeyPair();
        byte[] scalar = ((java.security.interfaces.ECPrivateKey) pair.getPrivate())
                .getS().toByteArray();
        // BigInteger가 부호 바이트를 앞에 붙일 수 있다 — 32바이트로 맞춘다.
        byte[] fixed = new byte[32];
        int from = Math.max(0, scalar.length - 32);
        System.arraycopy(scalar, from, fixed, 32 - (scalar.length - from), scalar.length - from);
        return new WebPushProperties(
                WebPushTestAccess.base64Url(encodePoint((ECPublicKey) pair.getPublic())),
                WebPushTestAccess.base64Url(fixed), SUBJECT);
    }

    private static byte[] encodePoint(ECPublicKey key) {
        byte[] encoded = new byte[65];
        encoded[0] = 0x04;
        copy(key.getW().getAffineX(), encoded, 1);
        copy(key.getW().getAffineY(), encoded, 33);
        return encoded;
    }

    private static void copy(BigInteger value, byte[] target, int offset) {
        byte[] bytes = value.toByteArray();
        int from = Math.max(0, bytes.length - 32);
        int length = bytes.length - from;
        System.arraycopy(bytes, from, target, offset + 32 - length, length);
    }

    private static java.security.PublicKey publicKeyOf(byte[] uncompressed) throws Exception {
        BigInteger x = new BigInteger(1, Arrays.copyOfRange(uncompressed, 1, 33));
        BigInteger y = new BigInteger(1, Arrays.copyOfRange(uncompressed, 33, 65));
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC", "BC");
        generator.initialize(new ECGenParameterSpec("secp256r1"), new SecureRandom());
        var params = ((ECPublicKey) generator.generateKeyPair().getPublic()).getParams();
        return KeyFactory.getInstance("EC", "BC")
                .generatePublic(new ECPublicKeySpec(new ECPoint(x, y), params));
    }

    private static byte[] hkdf(byte[] salt, byte[] ikm, byte[] info, int length) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256", "BC");
        mac.init(new SecretKeySpec(salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(ikm);
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        mac.update(info);
        mac.update((byte) 1);
        return Arrays.copyOf(mac.doFinal(), length);
    }

    private static byte[] concat(byte[]... parts) {
        int total = 0;
        for (byte[] part : parts) {
            total += part.length;
        }
        byte[] result = new byte[total];
        int at = 0;
        for (byte[] part : parts) {
            System.arraycopy(part, 0, result, at, part.length);
            at += part.length;
        }
        return result;
    }

    private static byte[] decode(String value) {
        return Base64.getUrlDecoder().decode(value);
    }
}
