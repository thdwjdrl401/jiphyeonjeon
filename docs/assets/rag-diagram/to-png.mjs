// SVG 한 장을 PPT용 PNG로 굽는다. build.py 가 부른다.
// 2배 밀도로 뽑는다 — 슬라이드를 확대하거나 큰 화면에 띄웠을 때 글자가 뭉개지지 않게.
import sharp from 'sharp'

const [input, output] = process.argv.slice(2)
const info = await sharp(input, { density: 144 }).png({ compressionLevel: 9 }).toFile(output)
process.stdout.write(`PNG  ${output}  ${info.width}x${info.height}\n`)
