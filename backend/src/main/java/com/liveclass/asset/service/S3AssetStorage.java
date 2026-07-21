package com.liveclass.asset.service;

import com.liveclass.asset.config.AssetStorageProperties;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;

/**
 * MinIO/S3 호환 스토리지 구현. presign은 로컬 서명 계산이라 네트워크 접속이 없고, exists만 실제로
 * headObject를 친다. 클라이언트가 presigned PUT으로 직접 올리므로 바이트는 이 서버를 거치지 않는다.
 */
@Component
public class S3AssetStorage implements AssetStorage {

    private final S3Presigner presigner;
    private final S3Client s3Client;
    private final String bucket;

    public S3AssetStorage(S3Presigner presigner, S3Client s3Client, AssetStorageProperties props) {
        this.presigner = presigner;
        this.s3Client = s3Client;
        this.bucket = props.getBucket();
    }

    @Override
    public PresignedUpload presignUpload(String objectKey, String contentType, long contentLength, Duration ttl) {
        PutObjectRequest put = PutObjectRequest.builder()
                .bucket(bucket)
                .key(objectKey)
                .contentType(contentType)
                .contentLength(contentLength)   // 서명에 포함 → 클라가 이 크기로만 PUT 가능(초과 차단)
                .build();
        var presigned = presigner.presignPutObject(PutObjectPresignRequest.builder()
                .signatureDuration(ttl)
                .putObjectRequest(put)
                .build());
        OffsetDateTime expiresAt = presigned.expiration().atOffset(ZoneOffset.UTC);
        return new PresignedUpload(presigned.url().toString(), expiresAt);
    }

    @Override
    public String presignDownload(String objectKey, Duration ttl) {
        GetObjectRequest get = GetObjectRequest.builder()
                .bucket(bucket)
                .key(objectKey)
                .build();
        var presigned = presigner.presignGetObject(GetObjectPresignRequest.builder()
                .signatureDuration(ttl)
                .getObjectRequest(get)
                .build());
        return presigned.url().toString();
    }

    @Override
    public Optional<StoredObject> head(String objectKey) {
        try {
            HeadObjectResponse resp = s3Client.headObject(HeadObjectRequest.builder()
                    .bucket(bucket)
                    .key(objectKey)
                    .build());
            long length = resp.contentLength() == null ? -1L : resp.contentLength();
            return Optional.of(new StoredObject(length, resp.contentType()));
        } catch (NoSuchKeyException e) {
            return Optional.empty();
        } catch (S3Exception e) {
            // MinIO/S3의 headObject는 404를 NoSuchKeyException 대신 S3Exception(404)로 던지기도 한다.
            if (e.statusCode() == 404) {
                return Optional.empty();
            }
            throw e;
        }
    }
}
