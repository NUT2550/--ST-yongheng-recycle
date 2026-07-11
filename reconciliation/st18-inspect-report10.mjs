/**
 * ST-18: Inspect the NEW sales file (ขาย 9-7-2569) which is report10 format
 */
import xlsx from 'xlsx'
import fs from 'fs'

function fixThai(s) {
  if (s == null) return ''
  if (typeof s !== 'string') s = String(s)
  if (/[\x80-\xFF]/.test(s)) {
    try { return new TextDecoder('windows-874').decode(Buffer.from(s, 'latin1')) } catch { return s }
  }
  return s
}

const FILE = '/home/z/my-project/upload/ขาย 9-7-2569 แบบละเอียด.xls'
console.log('FILE:', FILE.split('/').pop())

const buf = fs.readFileSync(FILE)
const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
console.log('Sheet:', wb.SheetNames)
const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
console.log('Total rows:', rows.length)

console.log('\n--- ALL rows (first 14 cols) ---')
for (let i = 0; i < rows.length; i++) {
  const r = rows[i] || []
  const fixed = r.map(c => c == null ? '' : (typeof c === 'string' ? fixThai(c) : c))
  const display = fixed.slice(0, 14).map(c => {
    const s = String(c)
    return s.length > 30 ? s.substring(0, 30) + '…' : s
  })
  console.log(`  [${i}] ${JSON.stringify(display)}`)
}

// Check for marker
console.log('\n--- Markers ---')
for (let i = 0; i < rows.length; i++) {
  const r = rows[i] || []
  const text = r.map(c => c == null ? '' : fixThai(String(c))).join(' ')
  if (text.includes('report') || text.includes('rpt')) {
    console.log(`  [${i}] ${text.substring(0, 100)}`)
  }
}

// Check for grand total
console.log('\n--- Grand total ---')
for (let i = 0; i < rows.length; i++) {
  const r = rows[i] || []
  if (fixThai(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) {
    console.log(`  [${i}] col 12 = ${r[12]}`)
  }
}
