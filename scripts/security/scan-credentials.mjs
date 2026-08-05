import { execSync } from 'child_process'
import { readFileSync } from 'fs'

const CREDENTIAL_URL_PATTERN = /(?:postgresql|postgres):\/\/[^:\s]+:[^\s@]+@[^\s'"]+/g

const ALLOWED_SUBSTRINGS = [
  'st62_test_nonprod_only','st70_test_nonprod_only','st71_test_nonprod_only',
  'localhost','127.0.0.1','0.0.0.0',
  'YOUR_PASSWORD','PROJECT_REF','pooler-host','db-host',
]

const ALLOWED_FILES = new Set([
  'tests/st70-sorting-cancellation-history.test.ts',
  'tests/st27-credential-scan.test.ts',
  'scripts/security/scan-credentials.mjs',
])

const SCAN_EXTENSIONS = new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.yml','.yaml','.sh','.bash','.env','.md','.txt','.sql','.prisma'])

function getTrackedFiles() {
  return execSync('git ls-files', { encoding: 'utf8', maxBuffer: 50*1024*1024 }).trim().split('\n').filter(Boolean)
}
function isScannable(filename) {
  const lower = filename.toLowerCase()
  for (const ext of SCAN_EXTENSIONS) { if (lower.endsWith(ext)) return true }
  return false
}
function isAllowed(match) { return ALLOWED_SUBSTRINGS.some(sub => match.includes(sub)) }
function isFileAllowed(filename) { return ALLOWED_FILES.has(filename) }

function scanFile(filename, content) {
  if (isFileAllowed(filename)) return []
  const violations = []
  const matches = content.match(CREDENTIAL_URL_PATTERN) || []
  for (const match of matches) {
    if (isAllowed(match)) continue
    violations.push({ file: filename, category: 'embedded-database-credential' })
  }
  return violations
}

function main() {
  const files = getTrackedFiles()
  const allViolations = []
  for (const file of files) {
    if (!isScannable(file)) continue
    let content
    try { content = readFileSync(file, 'utf8') } catch { continue }
    allViolations.push(...scanFile(file, content))
  }
  if (allViolations.length === 0) {
    console.log('✅ No embedded database credentials found.')
    process.exit(0)
  }
  console.error(`❌ Found ${allViolations.length} file(s) with embedded database credentials:`)
  for (const v of allViolations) { console.error(`  ${v.file} — ${v.category}`) }
  console.error('Use environment variables instead. See scripts/lib/require-db-url.mjs')
  process.exit(1)
}
main().catch(err => { console.error(`Scanner error: ${err.message}`); process.exit(2) })
