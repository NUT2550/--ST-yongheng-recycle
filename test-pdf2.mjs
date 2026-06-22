import * as pdfjsLib from '/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.mjs'

const pdfPath = '/home/z/my-project/upload/สต๊อกทั้งหมด_คัดแยก_เสียหาย - Google ชีต.pdf'
pdfjsLib.GlobalWorkerOptions.workerSrc = '/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'

const data = new Uint8Array(await Bun.file(pdfPath).arrayBuffer())
const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: true }).promise

// Get all items from page 1 with positions, group by row (y rounded to 2)
const page = await pdf.getPage(1)
const textContent = await page.getTextContent()

// Filter out empty strings (artifacts)
const items = textContent.items
  .filter(it => it.str && it.str.trim().length > 0)
  .map(it => ({ x: it.transform[4], y: it.transform[5], str: it.str, w: it.width || 0 }))

// Group by row (y rounded to nearest 2)
const rowMap = new Map()
for (const it of items) {
  const yKey = Math.round(it.y / 2) * 2
  if (!rowMap.has(yKey)) rowMap.set(yKey, [])
  rowMap.get(yKey).push(it)
}

// Sort rows by y descending (top to bottom in PDF coords where higher y = top)
const sortedRows = [...rowMap.entries()].sort((a, b) => b[0] - a[0])

console.log('=== Rows on page 1 (showing ALL rows) ===')
for (let i = 0; i < sortedRows.length; i++) {
  const [y, rowItems] = sortedRows[i]
  // Sort items by x
  rowItems.sort((a, b) => a.x - b.x)
  // Combine items into a line, showing x positions
  const line = rowItems.map(it => `[${it.x.toFixed(0)}]${it.str}`).join(' ')
  console.log(`y=${y} | ${line}`)
}
