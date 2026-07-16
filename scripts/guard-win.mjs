// Windows 전용 npm 스크립트 가드.
// FE/BE 실행 스크립트는 OS별로 이원화돼 있다(Windows: `.\gradlew.bat`, 그 외: `./gradlew` = `:wsl` 변형).
// WSL/Linux/macOS에서 Windows용 스크립트를 실수로 실행하면, 크립틱한 `.gradlew.bat: not found`
// 대신 올바른 `:wsl` 변형을 안내하고 즉시 중단한다. Windows(win32)에서는 통과.
if (process.platform !== 'win32') {
  // predev → dev 처럼 pre 훅 이름에서 대상 스크립트명을 복원
  const event = process.env.npm_lifecycle_event || 'this'
  const target = event.startsWith('pre') ? event.slice(3) : event
  console.error('')
  console.error(`  [!] \`npm run ${target}\` 는 Windows 전용입니다 (.\\gradlew.bat).`)
  console.error(`      현재 OS(${process.platform})에서는 \`npm run ${target}:wsl\` 을 사용하세요.`)
  console.error('      (자세한 내용: RUN.md §3)')
  console.error('')
  process.exit(1)
}
