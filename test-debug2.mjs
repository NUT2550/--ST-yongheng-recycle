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

// Look at the page containing line 719 of pdf_text.txt (around 04/05/26 bill)
// Pages: page 1 = lines 1-103, page 2 = 104-205, page 3 = 206-310, page 4 = 311-415, page 5 = 416-525, page 6 = 526-630, page 7 = 631-745
// Line 719 is on page 7
console.log('=== Page 7 rows around y=190-120 (looking for 04/05/26 bill) ===')
const rows7 = await getPageRows(7)
for (const [y, rowItems] of rows7) {
  if (y > 200 || y < 100) continue
  rowItems.sort((a, b) => a.x - b.x)
  const line = rowItems.map(it => `[${it.x.toFixed(0)}]${it.str}`).join(' ')
  console.log(`y=${y} | ${line}`)
}
