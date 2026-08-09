package com.liveclass.auth.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

/**
 * 임시 비밀번호를 메일로 보낸다.
 *
 * <p><b>비밀번호를 로그에 남기지 않는다.</b> 이 클래스가 다루는 값은 그 자체로 계정을 여는 열쇠라,
 * 실패를 기록할 때도 수신자와 원인만 남긴다.
 */
@Component
public class PasswordResetMailer {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetMailer.class);

    private final JavaMailSender mailSender;
    private final String from;
    private final String serviceName;

    public PasswordResetMailer(JavaMailSender mailSender,
                               @Value("${mail.from:${spring.mail.username:}}") String from,
                               @Value("${mail.service-name:LiveClass}") String serviceName) {
        this.mailSender = mailSender;
        this.from = from;
        this.serviceName = serviceName;
    }

    /**
     * @throws org.springframework.mail.MailException 발송 실패. 호출자가 사용자에게 어떻게 답할지 정한다.
     */
    public void sendTemporaryPassword(String email, String temporaryPassword) {
        SimpleMailMessage message = new SimpleMailMessage();
        if (!from.isBlank()) {
            message.setFrom(from);
        }
        message.setTo(email);
        message.setSubject("[" + serviceName + "] 임시 비밀번호를 보내 드립니다");
        message.setText(body(temporaryPassword));
        mailSender.send(message);
        log.info("임시 비밀번호 메일 발송 to={}", masked(email));
    }

    /**
     * 본문. <b>다음에 할 일을 먼저 말한다</b> — 임시 비밀번호만 받고 로그인하면 어차피 변경 화면에
     * 걸리므로, 그 사실을 모른 채 "왜 또 물어보지" 하게 두지 않는다.
     */
    private String body(String temporaryPassword) {
        return """
                임시 비밀번호가 발급되었습니다.

                    %s

                이 비밀번호로 로그인하면 곧바로 새 비밀번호를 정하는 화면이 열립니다.
                로그인 뒤 반드시 새 비밀번호로 바꿔 주세요 — 그 전까지는 다른 기능을 사용할 수 없습니다.

                본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다. 다만 위 임시 비밀번호로
                로그인이 가능하므로, 직접 로그인해 새 비밀번호로 바꾸시길 권합니다.
                """.formatted(temporaryPassword);
    }

    /** 로그에 남기는 수신자. 도메인만 남기고 계정 부분은 앞 두 글자까지만 둔다. */
    private String masked(String email) {
        int at = email.indexOf('@');
        if (at <= 0) {
            return "***";
        }
        String name = email.substring(0, at);
        String head = name.length() <= 2 ? name : name.substring(0, 2);
        return head + "***" + email.substring(at);
    }
}
