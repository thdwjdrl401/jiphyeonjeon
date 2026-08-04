package com.liveclass.asset.domain;

public enum AssetKind {
    PROFILE_IMAGE,
    THUMBNAIL,
    MATERIAL,
    /** 강조 판서 캡처 이미지(ADR-0074). 이미지 정책(PNG·5MiB)을 그대로 탄다. */
    ANNOTATION_SNAPSHOT
}
