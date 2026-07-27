package com.liveclass.video.service;

import com.liveclass.video.config.EgressProperties;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;

/**
 * Egress 출력 버킷(MinIO/S3)에 대한 매니페스트 확인·서빙. asset 모듈과 <b>다른</b> 스토리지 설정
 * ({@code livekit.egress.*})을 쓰므로 자체 {@link S3Client}·{@link S3Presigner}를 생성자에서 만든다 —
 * 공용 빈을 새로 등록하면 asset의 빈과 타입 충돌하므로 빈이 아닌 필드로 둔다. 클라이언트 생성은 lazy라
 * (첫 호출 전 네트워크 접속 없음) MinIO 없이도 부팅된다.
 *
 * <p>{@link RecordingStorage}(webhook VERIFYING의 HEAD)와 {@link ReplayStorage}(재생 매니페스트 읽기·
 * 세그먼트 presign)를 한 어댑터가 구현한다 — 같은 egress 버킷·자격을 공유하기 때문이다.
 */
@Component
public class S3RecordingStorage implements RecordingStorage, ReplayStorage {

    private final S3Client s3Client;
    private final S3Presigner presigner;

    public S3RecordingStorage(EgressProperties egress) {
        this.s3Client = S3Client.builder()
                .endpointOverride(endpoint(egress))
                .region(region(egress))
                .credentialsProvider(credentials(egress))
                .serviceConfiguration(serviceConfiguration(egress))
                .build();
        this.presigner = S3Presigner.builder()
                .endpointOverride(endpoint(egress))
                .region(region(egress))
                .credentialsProvider(credentials(egress))
                .serviceConfiguration(serviceConfiguration(egress))
                .build();
    }

    /** {@link S3Client}·{@link S3Presigner}가 공유하는 접속 설정 — 둘 다 같은 egress 버킷·자격을 쓴다. */
    private static URI endpoint(EgressProperties egress) {
        return URI.create(egress.s3Endpoint());
    }

    private static Region region(EgressProperties egress) {
        return Region.of(egress.s3Region());
    }

    private static StaticCredentialsProvider credentials(EgressProperties egress) {
        return StaticCredentialsProvider.create(
                AwsBasicCredentials.create(egress.s3AccessKey(), egress.s3Secret()));
    }

    private static S3Configuration serviceConfiguration(EgressProperties egress) {
        return S3Configuration.builder()
                .pathStyleAccessEnabled(egress.forcePathStyle())
                .build();
    }

    @Override
    public Optional<Long> head(String bucket, String key) {
        try {
            HeadObjectResponse resp = s3Client.headObject(HeadObjectRequest.builder()
                    .bucket(bucket)
                    .key(key)
                    .build());
            return Optional.of(resp.contentLength() == null ? -1L : resp.contentLength());
        } catch (NoSuchKeyException e) {
            return Optional.empty();
        } catch (S3Exception e) {
            // MinIO/S3의 headObject는 404를 NoSuchKeyException 대신 S3Exception(404)로 던지기도 한다 → 부재 확정.
            if (e.statusCode() == 404) {
                return Optional.empty();
            }
            throw e;   // 그 외(권한·타임아웃·5xx 등)는 '확인 불가' — 호출자가 fail-open 판단
        }
    }

    @Override
    public String readManifest(String bucket, String key) {
        try {
            ResponseBytes<GetObjectResponse> bytes = s3Client.getObjectAsBytes(GetObjectRequest.builder()
                    .bucket(bucket)
                    .key(key)
                    .build());
            return bytes.asString(StandardCharsets.UTF_8);
        } catch (NoSuchKeyException e) {
            throw new ReplayManifestMissingException("매니페스트를 찾을 수 없습니다: " + key);
        } catch (S3Exception e) {
            // MinIO/S3의 getObject도 404를 NoSuchKeyException 대신 S3Exception(404)로 던지기도 한다(head()와 동일 이유).
            if (e.statusCode() == 404) {
                throw new ReplayManifestMissingException("매니페스트를 찾을 수 없습니다: " + key);
            }
            throw e;   // 그 외(권한·타임아웃·5xx 등)는 스토리지 장애 — 그대로 전파.
        }
    }

    @Override
    public String presignSegment(String bucket, String key, Duration ttl) {
        // presign은 로컬 서명 계산이라 네트워크 접속이 없다 — 세그먼트 바이트는 클라가 스토리지에서 직접 받는다.
        var presigned = presigner.presignGetObject(GetObjectPresignRequest.builder()
                .signatureDuration(ttl)
                .getObjectRequest(GetObjectRequest.builder().bucket(bucket).key(key).build())
                .build());
        return presigned.url().toString();
    }
}
