package com.liveclass.video.service;

import com.liveclass.video.config.EgressProperties;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.net.URI;
import java.util.Optional;

/**
 * Egress 출력 버킷(MinIO/S3)에 대한 매니페스트 존재 확인. asset 모듈과 <b>다른</b> 스토리지 설정
 * ({@code livekit.egress.*})을 쓰므로 자체 {@link S3Client}를 생성자에서 만든다 — 공용 {@code S3Client}
 * 빈을 새로 등록하면 asset의 빈과 타입 충돌하므로 빈이 아닌 필드로 둔다. 클라이언트 생성은 lazy라
 * (첫 호출 전 네트워크 접속 없음) MinIO 없이도 부팅된다.
 */
@Component
public class S3RecordingStorage implements RecordingStorage {

    private final S3Client s3Client;

    public S3RecordingStorage(EgressProperties egress) {
        this.s3Client = S3Client.builder()
                .endpointOverride(URI.create(egress.s3Endpoint()))
                .region(Region.of(egress.s3Region()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(egress.s3AccessKey(), egress.s3Secret())))
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(egress.forcePathStyle())
                        .build())
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
}
