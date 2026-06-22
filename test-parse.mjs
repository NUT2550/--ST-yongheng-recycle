import * as pdfjsLib from '/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.mjs'

const pdfPath = '/home/z/my-project/upload/สต๊อกทั้งหมด_คัดแยก_เสียหาย - Google ชีต.pdf'
pdfjsLib.GlobalWorkerOptions.workerSrc = '/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'

const data = new Uint8Array(await Bun.file(pdfPath).arrayBuffer())
const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true, useSystemFonts: true }).promise

const COLUMN_RANGES = [
  { name: 'date',          min: 0,   max: 75 },
  { name: 'room',          min: 75,  max: 92 },
  { name: 'sourceName',    min: 92,  max: 108 },
  { name: 'sourceWeight',  min: 108, max: 125 },
  { name: 'sourceWeight2', min: 125, max: 145 },
  { name: 'loss',          min: 145, max: 160 },
  { name: 'sourceCostKg',  min: 160, max: 175 },
  { name: 'sourceTotal',   min: 175, max: 195 },
  { name: 'sortedName',    min: 195, max: 225 },
  { name: 'sortedWeight',  min: 225, max: 248 },
  { name: 'buyPrice',      min: 248, max: 268 },
  { name: 'costKg',        min: 268, max: 285 },
  { name: 'profitKg',      min: 285, max: 302 },
  { name: 'totalValue',    min: 302, max: 328 },
  { name: 'bonus10',       min: 328, max: 348 },
  { name: 'billTotalBonus',min: 348, max: 1000 },
]

function getColumn(x) {
  for (const col of COLUMN_RANGES) {
    if (x >= col.min && x < col.max) return col.name
  }
  return ''
}

function parseNumber(s) {
  if (!s) return 0
  const cleaned = s.replace(/,/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

function cleanText(s) {
  return s.replace(/\[\d+\]/g, '').replace(/\s+/g, '').trim()
}

const allRows = []

for (let p = 1; p <= pdf.numPages; p++) {
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

  const sortedRowYs = [...rowMap.keys()].sort((a, b) => b - a)

  for (const y of sortedRowYs) {
    const rowItems = rowMap.get(y).sort((a, b) => a.x - b.x)
    const cols = {}
    for (const col of COLUMN_RANGES) cols[col.name] = []
    for (const it of rowItems) {
      const col = getColumn(it.x)
      if (col) cols[col].push(it.str)
    }
    allRows.push({
      y, page: p,
      date: cols.date.join('').trim(),
      room: cols.room.join('').trim(),
      sourceName: cleanText(cols.sourceName.join('')),
      sourceWeight: parseNumber(cols.sourceWeight.join('')),
      sourceWeight2: parseNumber(cols.sourceWeight2.join('')),
      loss: parseNumber(cols.loss.join('')),
      sourceCostKg: parseNumber(cols.sourceCostKg.join('')),
      sourceTotal: parseNumber(cols.sourceTotal.join('')),
      sortedName: cleanText(cols.sortedName.join('')),
      sortedWeight: parseNumber(cols.sortedWeight.join('')),
      buyPrice: parseNumber(cols.buyPrice.join('')),
      costKg: parseNumber(cols.costKg.join('')),
      profitKg: parseNumber(cols.profitKg.join('')),
      totalValue: parseNumber(cols.totalValue.join('')),
      bonus10: parseNumber(cols.bonus10.join('')),
    })
  }
}

// Now identify bills
const DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/26$/
const bills = []
let currentBill = null

for (let i = 0; i < allRows.length; i++) {
  const row = allRows[i]
  const dateMatch = row.date.match(DATE_PATTERN)

  if (dateMatch) {
    if (currentBill) bills.push(currentBill)
    let sourceName = row.sourceName
    if (!sourceName) {
      const prevRow = allRows[i - 1]
      const nextRow = allRows[i + 1]
      const prevName = prevRow && Math.abs(prevRow.y - row.y) <= 6 ? prevRow.sourceName : ''
      const nextName = nextRow && Math.abs(nextRow.y - row.y) <= 6 ? nextRow.sourceName : ''
      sourceName = cleanText(prevName + nextName)
    }
    currentBill = {
      page: row.page, y: row.y,
      date: row.date, room: row.room,
      sourceName,
      sourceWeight: row.sourceWeight,
      sourceCostKg: row.sourceCostKg,
      items: [],
    }
    if (row.sortedName && row.sortedWeight > 0) {
      currentBill.items.push({
        sortedName: row.sortedName,
        sortedWeight: row.sortedWeight,
        buyPrice: row.buyPrice, costKg: row.costKg,
        isWaste: row.sortedName === 'ขยะ',
      })
    }
  } else if (currentBill && row.sortedWeight > 0) {
    let sortedName = row.sortedName
    if (!sortedName) {
      const prevRow = allRows[i - 1]
      const nextRow = allRows[i + 1]
      const prevName = prevRow && Math.abs(prevRow.y - row.y) <= 6 ? prevRow.sortedName : ''
      const nextName = nextRow && Math.abs(nextRow.y - row.y) <= 6 ? nextRow.sortedName : ''
      sortedName = cleanText(prevName + nextName)
    }
    if (sortedName) {
      currentBill.items.push({
        sortedName,
        sortedWeight: row.sortedWeight,
        buyPrice: row.buyPrice,
        costKg: row.costKg || currentBill.sourceCostKg,
        isWaste: sortedName === 'ขยะ',
      })
    }
  }
}
if (currentBill) bills.push(currentBill)

console.log(`Total bills: ${bills.length}`)
console.log('\n=== Source names ===')
const sourceNames = new Map()
for (const bill of bills) {
  const n = bill.sourceName || '(empty)'
  sourceNames.set(n, (sourceNames.get(n) || 0) + 1)
}
for (const [name, count] of [...sourceNames.entries()].sort()) {
  console.log(`  "${name}": ${count}`)
}

console.log('\n=== Sorted names ===')
const sortedNames = new Map()
for (const bill of bills) {
  for (const item of bill.items) {
    const n = item.sortedName || '(empty)'
    sortedNames.set(n, (sortedNames.get(n) || 0) + 1)
  }
}
for (const [name, count] of [...sortedNames.entries()].sort()) {
  console.log(`  "${name}": ${count}`)
}

console.log('\n=== Bills with empty source name ===')
for (const bill of bills) {
  if (!bill.sourceName) {
    console.log(`  page ${bill.page} y=${bill.y} date=${bill.date} room=${bill.room}`)
  }
}

console.log('\n=== Bills with empty sorted name on items ===')
for (const bill of bills) {
  for (const item of bill.items) {
    if (!item.sortedName) {
      console.log(`  bill date=${bill.date} source=${bill.sourceName} item weight=${item.sortedWeight}`)
    }
  }
}

console.log('\n=== First 10 bills (debug) ===')
for (let i = 0; i < 10; i++) {
  const bill = bills[i]
  console.log(`Bill ${i + 1}: date=${bill.date} room=${bill.room} source="${bill.sourceName}" weight=${bill.sourceWeight} cost=${bill.sourceCostKg} items=${bill.items.length}`)
  for (const item of bill.items) {
    console.log(`    - ${item.sortedName} ${item.sortedWeight}kg buy=${item.buyPrice} cost=${item.costKg} waste=${item.isWaste}`)
  }
}

// Total bonus
let totalBonus = 0
for (const bill of bills) {
  const isKhongKaew = bill.sourceName === 'ของแกะ'
  for (const item of bill.items) {
    if (isKhongKaew) continue
    const bonus = Math.max(0, (item.buyPrice - bill.sourceCostKg) * item.sortedWeight * 0.10)
    totalBonus += Math.round(bonus * 100) / 100
  }
}
console.log(`\n=== Total bonus: ${totalBonus.toFixed(2)} ===`)

let totalSortedWeight = 0
for (const bill of bills) {
  for (const item of bill.items) {
    if (!item.isWaste) totalSortedWeight += item.sortedWeight
  }
}
console.log(`=== Total sorted (non-waste) weight: ${totalSortedWeight.toFixed(2)} ===`)
