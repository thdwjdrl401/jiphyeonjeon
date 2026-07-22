package com.liveclass.asset.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 에셋 스토리지(MinIO/S3 호환) 접속·정책 설정. 값은 application.yml의 asset.storage.* 에서 온다.
 * 비밀키는 커밋하지 않는다 — dev 기본값만 두고 운영은 환경변수로 주입한다.
 */
@ConfigurationProperties("asset.storage")
public class AssetStorageProperties {

    /** S3 호환 엔드포인트. MinIO면 http://host:9000 형태. */
    private String endpoint;

    /** 리전. MinIO는 의미 없지만 SDK가 요구한다. */
    private String region = "us-east-1";

    /** 에셋을 담는 버킷. */
    private String bucket = "liveclass-assets";

    private String accessKey;

    private String secretKey;

    /** MinIO는 path-style(호스트/버킷)만 지원 → 기본 true. 실 S3는 false 가능. */
    private boolean pathStyle = true;

    /** presigned 업로드 URL 유효기간(초). */
    private long uploadTtlSeconds = 600;

    /** presigned 다운로드 URL 유효기간(초). */
    private long downloadTtlSeconds = 3600;

    public String getEndpoint() {
        return endpoint;
    }

    public void setEndpoint(String endpoint) {
        this.endpoint = endpoint;
    }

    public String getRegion() {
        return region;
    }

    public void setRegion(String region) {
        this.region = region;
    }

    public String getBucket() {
        return bucket;
    }

    public void setBucket(String bucket) {
        this.bucket = bucket;
    }

    public String getAccessKey() {
        return accessKey;
    }

    public void setAccessKey(String accessKey) {
        this.accessKey = accessKey;
    }

    public String getSecretKey() {
        return secretKey;
    }

    public void setSecretKey(String secretKey) {
        this.secretKey = secretKey;
    }

    public boolean isPathStyle() {
        return pathStyle;
    }

    public void setPathStyle(boolean pathStyle) {
        this.pathStyle = pathStyle;
    }

    public long getUploadTtlSeconds() {
        return uploadTtlSeconds;
    }

    public void setUploadTtlSeconds(long uploadTtlSeconds) {
        this.uploadTtlSeconds = uploadTtlSeconds;
    }

    public long getDownloadTtlSeconds() {
        return downloadTtlSeconds;
    }

    public void setDownloadTtlSeconds(long downloadTtlSeconds) {
        this.downloadTtlSeconds = downloadTtlSeconds;
    }
}
