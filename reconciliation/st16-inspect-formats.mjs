/**
 * ST-16: Inspect both Excel files to understand report03 and report04 structures.
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

const FILES = [
  '/home/z/my-project/upload/ซื้อ 3-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/upload/ซื้อ 10-7-2569 แบบละเอียด.xls',
]

for (const FILE of FILES) {
  const fileName = FILE.split('/').pop()
  console.log('\n' + '='.repeat(80))
  console.log('FILE:', fileName)
  console.log('='.repeat(80))

  const buf = fs.readFileSync(FILE)
  const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
  const sheetName = wb.SheetNames[0]
  console.log('Sheet:', sheetName)
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null })
  console.log('Total rows:', rows.length)

  // Show first 25 rows + last 5 rows
  console.log('\n--- First 25 rows ---')
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const r = rows[i] || []
    const fixed = r.map(c => c == null ? '' : (typeof c === 'string' ? fixThai(c) : c))
    // Truncate for display
    const display = fixed.map(c => {
      const s = String(c)
      return s.length > 30 ? s.substring(0, 30) + '…' : s
    })
    console.log(`  [${i}] ${JSON.stringify(display)}`)
  }

  console.log('\n--- Last 5 rows ---')
  for (let i = Math.max(25, rows.length - 5); i < rows.length; i++) {
    const r = rows[i] || []
    const fixed = r.map(c => c == null ? '' : (typeof c === 'string' ? fixThai(c) : c))
    const display = fixed.map(c => {
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
}
