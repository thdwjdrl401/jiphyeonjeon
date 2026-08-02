package com.liveclass.video.service;

import com.liveclass.video.config.EgressProperties;
import com.liveclass.video.config.PlaybackProperties;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.Delete;
import software.amazon.awssdk.services.s3.model.DeleteObjectsRequest;
import software.amazon.awssdk.services.s3.model.DeleteObjectsResponse;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.ObjectIdentifier;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Optional;

/**
 * Egress 출력 버킷(MinIO/S3)에 대한 매니페스트 확인·서빙. asset 모듈과 <b>다른</b> 스토리지 설정
 * ({@code livekit.egress.*})을 쓰므로 자체 {@link S3Client}·{@link S3Presigner}를 생성자에서 만든다 —
 * 공용 빈을 새로 등록하면 asset의 빈과 타입 충돌하므로 빈이 아닌 필드로 둔다. 클라이언트 생성은 lazy라
 * (첫 호출 전 네트워크 접속 없음) MinIO 없이도 부팅된다.
 *
 * <p>{@link RecordingStorage}(webhook VERIFYING의 HEAD)와 {@link ReplayStorage}(재생 매니페스트 읽기·
 * 세그먼트 presign)를 한 어댑터가 구현한다 — 같은 egress 버킷·자격을 공유하기 때문이다.
 *
 * <p><b>주소가 둘인 이유</b>: {@link S3Client}(HEAD·GET)는 백엔드가 직접 부르므로 <b>내부</b> 주소를,
 * {@link S3Presigner}는 결과 URL을 브라우저가 여므로 <b>공개</b> 주소를 쓴다
 * ({@link PlaybackProperties#publicEndpoint}). SigV4가 Host를 서명에 포함하기 때문에 하나로 합칠 수 없다.
 */
@Component
public class S3RecordingStorage implements RecordingStorage, ReplayStorage {

    private final S3Client s3Client;
    private final S3Presigner presigner;

    public S3RecordingStorage(EgressProperties egress, PlaybackProperties playback) {
        this.s3Client = S3Client.builder()
                .endpointOverride(endpoint(egress.s3Endpoint()))
                .region(region(egress))
                .credentialsProvider(credentials(egress))
                .serviceConfiguration(serviceConfiguration(egress))
                .build();
        this.presigner = S3Presigner.builder()
                .endpointOverride(endpoint(publicEndpoint(egress, playback)))
                .region(region(egress))
                .credentialsProvider(credentials(egress))
                .serviceConfiguration(serviceConfiguration(egress))
                .build();
    }

    /** presign 대상 주소 — 설정이 없으면 내부 주소로 서명한다(단일 호스트 개발 환경). */
    private static String publicEndpoint(EgressProperties egress, PlaybackProperties playback) {
        return playback.publicEndpoint() != null ? playback.publicEndpoint() : egress.s3Endpoint();
    }

    private static URI endpoint(String value) {
        return URI.create(value);
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
    public long deletePrefix(String bucket, String prefix) {
        long deleted = 0;
        String continuationToken = null;
        do {
            ListObjectsV2Response listed = s3Client.listObjectsV2(ListObjectsV2Request.builder()
                    .bucket(bucket)
                    .prefix(prefix)
                    .continuationToken(continuationToken)
                    .build());
            List<ObjectIdentifier> keys = listed.contents().stream()
                    .map(o -> ObjectIdentifier.builder().key(o.key()).build())
                    .toList();
            if (!keys.isEmpty()) {
                // DeleteObjects는 한 번에 1000개까지고 목록 페이지도 기본 1000이라 페이지 단위로 그대로 넘긴다.
                DeleteObjectsResponse result = s3Client.deleteObjects(DeleteObjectsRequest.builder()
                        .bucket(bucket)
                        .delete(Delete.builder().objects(keys).build())
                        .build());
                deleted += keys.size() - result.errors().size();
                if (!result.errors().isEmpty()) {
                    // 일부만 지워진 것을 조용히 성공으로 넘기지 않는다 — 파일이 남았는지 호출자가 알아야 한다.
                    throw new IllegalStateException("녹화 객체 일부를 지우지 못했습니다: prefix=" + prefix
                            + ", 실패=" + result.errors().size() + "건, 첫 사유=" + result.errors().get(0).message());
                }
            }
            continuationToken = Boolean.TRUE.equals(listed.isTruncated()) ? listed.nextContinuationToken() : null;
        } while (continuationToken != null);
        return deleted;
    }

    @Override
    public Optional<String> findManifest(String bucket, String key) {
        try {
            ResponseBytes<GetObjectResponse> bytes = s3Client.getObjectAsBytes(GetObjectRequest.builder()
                    .bucket(bucket)
                    .key(key)
                    .build());
            return Optional.of(bytes.asString(StandardCharsets.UTF_8));
        } catch (NoSuchKeyException e) {
            return Optional.empty();
        } catch (S3Exception e) {
            // MinIO/S3의 getObject도 404를 NoSuchKeyException 대신 S3Exception(404)로 던지기도 한다(head()와 동일 이유).
            if (e.statusCode() == 404) {
                return Optional.empty();
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
