package com.liveclass.auth.service;

import com.liveclass.auth.api.UserContact;
import com.liveclass.auth.api.UserDirectory;
import com.liveclass.auth.api.UserView;
import com.liveclass.auth.repository.AppUserRepository;
import com.liveclass.asset.api.AssetDirectory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** UserDirectory 구현 — AppUser를 경계 DTO로 변환한다. */
@Service
public class UserDirectoryService implements UserDirectory {

    private final AppUserRepository appUserRepository;
    private final AssetDirectory assetDirectory;

    public UserDirectoryService(AppUserRepository appUserRepository, AssetDirectory assetDirectory) {
        this.appUserRepository = appUserRepository;
        this.assetDirectory = assetDirectory;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<UserView> findById(UUID userId) {
        return appUserRepository.findById(userId)
                .map(u -> new UserView(u.getId(), u.getDisplayName(), u.getRole().name()));
    }

    @Override
    @Transactional(readOnly = true)
    public List<UserContact> findContacts(Collection<UUID> userIds) {
        return appUserRepository.findAllById(userIds).stream()
                .map(u -> new UserContact(u.getId(), u.getDisplayName(), u.getEmail()))
                .toList();
    }

    /**
     * 사용자 → 에셋 → URL 두 단계를 각각 배치로 돈다. 목록 한 페이지에 사람이 여럿 있어도 왕복은
     * 두 번이다.
     */
    @Override
    @Transactional(readOnly = true)
    public Map<UUID, String> findAvatarUrls(Collection<UUID> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, UUID> assetByUser = new HashMap<>();
        for (var user : appUserRepository.findAllById(userIds)) {
            if (user.getProfileImageAssetId() != null) {
                assetByUser.put(user.getId(), user.getProfileImageAssetId());
            }
        }
        Map<UUID, String> urlByAsset = assetDirectory.resolveUrls(assetByUser.values());
        Map<UUID, String> urlByUser = new HashMap<>();
        assetByUser.forEach((userId, assetId) -> {
            String url = urlByAsset.get(assetId);
            if (url != null) {
                urlByUser.put(userId, url);
            }
        });
        return urlByUser;
    }
}
