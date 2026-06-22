import * as pdfjsLib from '/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.mjs'

const pdfPath = '/home/z/my-project/upload/สต๊อกทั้งหมด_คัดแยก_เสียหาย - Google ชีต.pdf'
pdfjsLib.GlobalWorkerOptions.workerSrc = '/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'

const data = new Uint8Array(await Bun.file(pdfPath).arrayBuffer())
const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: true }).promise

async function getPageRows(p) {
  const page = await pdf.getPage(p)
  const textContent = await page.getTextContent()
  const items = textContent.items
    .filter(it => it.str && it.str.trim().length > 0)
    .map(it => ({ x: it.transform[4], y: it.transform[5], str: it.str, w: it.width || 0 }))
  const rowMap = new Map()
  for (const it of items) {
    const yKey = Math.round(it.y / 2) * 2
    if (!rowMap.has(yKey)) rowMap.set(yKey, [])
    rowMap.get(yKey).push(it)
  }
  return [...rowMap.entries()].sort((a, b) => b[0] - a[0])
}

// Find bill 04/05/26 on page 7
console.log('=== Page 7 rows around y=210-195 (looking for 04/05/26 bill) ===')
const rows7 = await getPageRows(7)
for (const [y, rowItems] of rows7) {
  if (y > 225 || y < 190) continue
  rowItems.sort((a, b) => a.x - b.x)
  const line = rowItems.map(it => `[${it.x.toFixed(0)}]${it.str}`).join(' ')
  console.log(`y=${y} | ${line}`)
}
