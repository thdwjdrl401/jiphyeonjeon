package com.liveclass.auth.service;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;

/**
 * 메일로 보낼 임시 비밀번호를 만든다.
 *
 * <p><b>사람이 옮겨 적는 값이다.</b> 메일에서 복사해 붙이는 것이 보통이지만, 휴대폰으로 보고 노트북에
 * 치는 일도 흔하다. 그래서 서로 헷갈리는 글자({@code 0 O o 1 l I})는 빼고, 기호도 쓰지 않는다 —
 * 자판 배열마다 위치가 달라 오타의 대부분이 거기서 난다.
 *
 * <p>대신 <b>길이로 강도를 확보한다.</b> 아래 문자 집합은 54자이고 12자리면 약 69비트다. 임시 값이
 * 살아 있는 시간(첫 로그인 전까지)에는 충분히 크다.
 *
 * <p>정책은 "8자 이상, UTF-8 72바이트 이하"다(SignupRequest·ChangePasswordRequest). 여기서 만드는
 * 값은 12자 ASCII라 두 끝을 모두 넉넉히 지킨다.
 */
public final class TemporaryPassword {

    /** 헷갈리는 글자를 뺀 대문자. I·O가 없다. */
    private static final String UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    /** 헷갈리는 글자를 뺀 소문자. l·o가 없다. */
    private static final String LOWER = "abcdefghijkmnpqrstuvwxyz";
    /** 헷갈리는 숫자를 뺀 숫자. 0·1이 없다. */
    private static final String DIGIT = "23456789";
    private static final String ALL = UPPER + LOWER + DIGIT;

    static final int LENGTH = 12;

    private static final SecureRandom RANDOM = new SecureRandom();

    private TemporaryPassword() {
    }

    /**
     * 세 종류(대문자·소문자·숫자)를 <b>적어도 하나씩</b> 담아 만든다.
     *
     * <p>순수 무작위로 뽑으면 드물게 숫자가 하나도 없는 값이 나온다. 지금 정책은 복잡도를 요구하지
     * 않지만, 사용자가 이 값을 그대로 쓰다가 나중에 정책이 강해지면 재발급부터 막힌다. 만드는 쪽에서
     * 채워 두는 편이 싸다.
     *
     * <p>자리마다 앞에서 채우면 "첫 글자는 늘 대문자" 같은 규칙이 생겨 추측 범위를 좁힌다. 그래서
     * 채운 뒤 <b>섞는다</b>.
     */
    public static String generate() {
        List<Character> characters = new ArrayList<>(LENGTH);
        characters.add(pick(UPPER));
        characters.add(pick(LOWER));
        characters.add(pick(DIGIT));
        while (characters.size() < LENGTH) {
            characters.add(pick(ALL));
        }
        shuffle(characters);

        StringBuilder password = new StringBuilder(LENGTH);
        characters.forEach(password::append);
        return password.toString();
    }

    private static char pick(String pool) {
        return pool.charAt(RANDOM.nextInt(pool.length()));
    }

    /** Fisher–Yates. Collections.shuffle을 쓰면 기본 Random이라 SecureRandom을 명시해 넘긴다. */
    private static void shuffle(List<Character> characters) {
        for (int i = characters.size() - 1; i > 0; i--) {
            int j = RANDOM.nextInt(i + 1);
            Character swap = characters.get(i);
            characters.set(i, characters.get(j));
            characters.set(j, swap);
        }
    }
}
