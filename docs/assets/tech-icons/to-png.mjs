// SVG를 지정 크기 PNG로 굽는다. fetch-icons.sh 가 부른다.
//
// density를 크게 잡는 이유: sharp는 SVG를 먼저 래스터화한 뒤 리사이즈한다. 기본 72dpi로 24x24
// viewBox를 굽고 512로 늘리면 계단이 진다. 목표 크기에 맞춰 density를 올려 처음부터 크게 그린다.
import { readdir, mkdir } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import sharp from 'sharp'

const [svgDir, pngDir, sizeArg] = process.argv.slice(2)
const size = Number(sizeArg) || 512

await mkdir(pngDir, { recursive: true })

const files = (await readdir(svgDir)).filter((name) => extname(name) === '.svg').sort()
if (files.length === 0) throw new Error(`${svgDir} 에 svg가 없다`)

let failed = 0
for (const file of files) {
  const name = basename(file, '.svg')
  try {
    await sharp(join(svgDir, file), { density: Math.ceil((size / 24) * 72) })
      // contain + 투명 배경: 정사각형이 아닌 마크(예: AWS)도 비율을 지키고 여백만 비운다.
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(join(pngDir, `${name}.png`))
    process.stdout.write(`  ${name.padEnd(16)} ok\n`)
  } catch (error) {
    failed += 1
    process.stdout.write(`  ${name.padEnd(16)} 실패: ${error.message}\n`)
  }
}

process.stdout.write(`\n${files.length - failed}/${files.length} 변환 완료 → ${pngDir}\n`)
if (failed > 0) process.exit(1)
