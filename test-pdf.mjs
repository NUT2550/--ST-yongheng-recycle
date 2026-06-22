import * as pdfjsLib from '/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.mjs'

const pdfPath = '/home/z/my-project/upload/สต๊อกทั้งหมด_คัดแยก_เสียหาย - Google ชีต.pdf'

// Try to set worker; in node it may not need
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
} catch (e) {
  console.log('Worker set failed (ok):', e.message)
}

const data = new Uint8Array(await Bun.file(pdfPath).arrayBuffer())
const loadingTask = pdfjsLib.getDocument({
  data,
  disableFontFace: true,
  useSystemFonts: true,
})

const pdf = await loadingTask.promise
console.log('Total pages:', pdf.numPages)

// Look at page 1 first
const page = await pdf.getPage(1)
const viewport = page.getViewport({ scale: 1 })
console.log('Viewport:', viewport)

const textContent = await page.getTextContent()
console.log('Number of items on page 1:', textContent.items.length)

// Show first 80 items with positions
console.log('\n=== First 80 items on page 1 (x, y, text) ===')
for (let i = 0; i < Math.min(80, textContent.items.length); i++) {
  const item = textContent.items[i]
  const tr = item.transform
  // x = tr[4], y = tr[5]
  console.log(`x=${tr[4].toFixed(2)} y=${tr[5].toFixed(2)} w=${item.width?.toFixed(2)} | "${item.str}"`)
}
