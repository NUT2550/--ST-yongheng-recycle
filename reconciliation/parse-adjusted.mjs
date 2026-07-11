/**
 * Phase 1: Parse รายการสิ้นต้า_ปรับแล้ว.xls
 * Same TIS-620 / NFC normalization as previous tasks.
 */
import xlsx from 'xlsx'
import fs from 'fs'

const FILE = '/home/z/my-project/upload/รายการสิ้นต้า_ปรับแล้ว.xls'
const buf = fs.readFileSync(FILE)
const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
console.log('Total rows:', rows.length)
console.log('\n=== All rows (TIS-620 fixed) ===')
function fixThai(s) {
  if (s == null) return ''
  if (typeof s !== 'string') s = String(s)
  if (/[\x80-\xFF]/.test(s)) {
    try { return new TextDecoder('windows-874').decode(Buffer.from(s, 'latin1')) } catch { return s }
  }
  return s
}
for (let i = 0; i < rows.length; i++) {
  const r = rows[i] || []
  const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
  const hasData = fixed.some(c => c != null && String(c).trim() !== '')
  if (hasData) console.log(`  [${i}]`, JSON.stringify(fixed).substring(0, 250))
}
