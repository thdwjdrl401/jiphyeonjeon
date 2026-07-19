package com.liveclass.auth.service;

import com.liveclass.auth.api.UserDirectory;
import com.liveclass.auth.api.UserView;
import com.liveclass.auth.repository.AppUserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/** UserDirectory 구현 — AppUser를 경계 DTO로 변환한다. */
@Service
public class UserDirectoryService implements UserDirectory {

    private final AppUserRepository appUserRepository;

    public UserDirectoryService(AppUserRepository appUserRepository) {
        this.appUserRepository = appUserRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<UserView> findById(UUID userId) {
        return appUserRepository.findById(userId)
                .map(u -> new UserView(u.getId(), u.getDisplayName(), u.getRole().name()));
    }
}
