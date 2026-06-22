import * as pdfjsLib from '/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.mjs'

const pdfPath = '/home/z/my-project/upload/สต๊อกทั้งหมด_คัดแยก_เสียหาย - Google ชีต.pdf'
pdfjsLib.GlobalWorkerOptions.workerSrc = '/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'

const data = new Uint8Array(await Bun.file(pdfPath).arrayBuffer())
const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: true }).promise

// Get all items from specific pages and print rows around problematic bills
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

// Look at page 7 around y=590, y=566, y=178 (problematic bills)
for (const [page, yTarget] of [[4, 502], [6, 542], [7, 590], [7, 566], [7, 178], [8, 408], [8, 200], [9, 468], [9, 374]]) {
  console.log(`\n=== Page ${page} around y=${yTarget} ===`)
  const rows = await getPageRows(page)
  for (const [y, rowItems] of rows) {
    if (Math.abs(y - yTarget) > 15) continue
    rowItems.sort((a, b) => a.x - b.x)
    const line = rowItems.map(it => `[${it.x.toFixed(0)}]${it.str}`).join(' ')
    console.log(`y=${y} | ${line}`)
  }
}
