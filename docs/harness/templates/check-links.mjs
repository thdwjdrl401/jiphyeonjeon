// 하네스 문서 링크 검사기 — 상대경로 링크가 실제 파일을 가리키는지 확인.
// 문서가 삭제/이동됐는데 참조가 남는 "표류"를 커밋 시점에 잡는다.
// 활성화: docs/harness/ENFORCEMENT.md §G 참고 (pre-commit / CI 에 연결).
// 실행: node docs/harness/templates/check-links.mjs   (깨진 링크 있으면 exit 1)
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { execSync } from 'node:child_process';

// 추적 + 신규(무시 제외) md/mdc 문서 검사 — pre-commit 에서 새 파일도 잡히게.
const files = execSync('git ls-files --cached --others --exclude-standard "*.md" "*.mdc"', { encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean)
  .filter(f => !f.startsWith('frontend/node_modules') && !f.startsWith('node_modules'));

const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
let broken = 0, checked = 0;

for (const f of files) {
  const base = dirname(f);
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(linkRe)) {
    let tgt = m[1].trim();
    if (/^(https?:|#|mailto:)/.test(tgt)) continue;
    const path = tgt.split('#')[0];
    if (!path) continue;
    // GEMINI.md / .cursor 규칙 등 "루트에 놓일" 포인터는 루트 기준으로도 허용
    const candidates = [normalize(join(base, path)), normalize(path)];
    checked++;
    if (!candidates.some(existsSync)) {
      broken++; console.error(`BROKEN: ${f}  ->  ${tgt}`);
    }
  }
}
console.log(`checked ${checked} relative links in ${files.length} docs, broken=${broken}`);
process.exit(broken ? 1 : 0);
