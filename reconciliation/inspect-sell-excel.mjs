/**
 * Quick inspection of sales Excel files to understand the format.
 */
import xlsx from 'xlsx'
import fs from 'fs'

const FILES = [
  '/home/z/my-project/reconciliation/import-sell-2026-07-02-to-08/extracted/ขาย 2-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/reconciliation/import-sell-2026-07-02-to-08/extracted/ขาย 4-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/reconciliation/import-sell-2026-07-02-to-08/extracted/ขาย 6-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/reconciliation/import-sell-2026-07-02-to-08/extracted/ขาย 7-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/reconciliation/import-sell-2026-07-02-to-08/extracted/ขาย 8-7-2569 แบบละเอียด.xls',
]

function fixThai(s) {
  if (s == null) return ''
  if (typeof s !== 'string') s = String(s)
  if (/[\x80-\xFF]/.test(s)) {
    try { return new TextDecoder('windows-874').decode(Buffer.from(s, 'latin1')) } catch { return s }
  }
  return s
}

for (const FILE of FILES) {
  const fileName = FILE.split('/').pop()
  console.log('\n' + '='.repeat(80))
  console.log('FILE:', fileName)
  console.log('='.repeat(80))
  const buf = fs.readFileSync(FILE)
  const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
  const sheetName = wb.SheetNames[0]
  console.log('Sheet names:', wb.SheetNames)
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null })
  console.log(`Total rows: ${rows.length}`)
  console.log('\nFirst 15 rows (Thai-fixed):')
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const r = rows[i] || []
    const fixed = r.map(c => c == null ? '' : (typeof c === 'string' ? fixThai(c) : c))
    // Truncate long values for display
    const display = fixed.map(c => {
      const s = String(c)
      return s.length > 25 ? s.substring(0, 25) + '…' : s
    })
    console.log(`  [${i}] ${JSON.stringify(display)}`)
  }
  if (rows.length > 15) {
    console.log('\nLast 5 rows:')
    for (let i = Math.max(15, rows.length - 5); i < rows.length; i++) {
      const r = rows[i] || []
      const fixed = r.map(c => c == null ? '' : (typeof c === 'string' ? fixThai(c) : c))
      const display = fixed.map(c => {
        const s = String(c)
        return s.length > 25 ? s.substring(0, 25) + '…' : s
      })
      console.log(`  [${i}] ${JSON.stringify(display)}`)
    }
  }
}
