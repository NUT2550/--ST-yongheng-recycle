/**
 * Parse รายการสิ้นต้า.xls — old/source product list
 */
import xlsx from 'xlsx'
import fs from 'fs'

const FILE = '/home/z/my-project/upload/รายการสิ้นต้า.xls'
console.log('Reading:', FILE)
const buf = fs.readFileSync(FILE)
const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
console.log('Sheets:', wb.SheetNames)

const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
console.log('Total rows:', rows.length)

// TIS-620 fix (same as detailed import dialog)
function fixThaiText(text) {
  if (!text) return text
  if (typeof text !== 'string') text = String(text)
  const hasGarbled = [...text].some(c => c.charCodeAt(0) >= 0x80 && c.charCodeAt(0) <= 0xFF)
  if (!hasGarbled) return text
  try {
    const bytes = new Uint8Array([...text].map(c => c.charCodeAt(0) & 0xFF))
    return new TextDecoder('windows-874').decode(bytes)
  } catch {
    return text
  }
}

console.log('\n=== All rows (with TIS-620 fix applied) ===')
for (let i = 0; i < rows.length; i++) {
  const r = rows[i] || []
  const fixed = r.map(c => {
    if (c == null) return null
    if (typeof c === 'string') return fixThaiText(c)
    return c
  })
  // Only print non-empty rows or rows with product codes
  const hasData = fixed.some(c => c != null && String(c).trim() !== '')
  if (hasData) {
    console.log(`  [${i}]`, JSON.stringify(fixed).substring(0, 250))
  }
}
