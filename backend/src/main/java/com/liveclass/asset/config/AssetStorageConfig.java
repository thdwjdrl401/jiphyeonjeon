package com.liveclass.asset.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import java.net.URI;

/**
 * S3 호환 스토리지 클라이언트/프리사이너 빈. 엔드포인트·path-style·정적 자격증명을 properties에서 읽는다.
 * S3Client·S3Presigner 생성은 lazy(첫 호출 전까지 네트워크 접속 없음)라 MinIO 없이도 빈 생성이 되고,
 * 그래서 테스트에서 이 빈들을 살려둔 채 AssetStorage만 모킹해도 앱 컨텍스트가 뜬다.
 */
@Configuration
@EnableConfigurationProperties(AssetStorageProperties.class)
public class AssetStorageConfig {

    @Bean
    public S3Client s3Client(AssetStorageProperties props) {
        return S3Client.builder()
                .endpointOverride(URI.create(props.getEndpoint()))
                .region(Region.of(props.getRegion()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(props.getAccessKey(), props.getSecretKey())))
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(props.isPathStyle())
                        .build())
                .build();
    }

    @Bean
    public S3Presigner s3Presigner(AssetStorageProperties props) {
        return S3Presigner.builder()
                .endpointOverride(URI.create(props.getEndpoint()))
                .region(Region.of(props.getRegion()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(props.getAccessKey(), props.getSecretKey())))
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(props.isPathStyle())
                        .build())
                .build();
    }
}
