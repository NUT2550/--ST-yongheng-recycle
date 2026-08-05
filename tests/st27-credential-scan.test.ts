/**
 * ST-27 Security: Tests for the credential scanner + fail-closed loader + write guard.
 */
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const CREDENTIAL_URL_PATTERN = /(?:postgresql|postgres):\/\/[^:\s]+:[^\s@]+@[^\s'"]+/g
const ALLOWED_SUBSTRINGS = ['st62_test_nonprod_only','st70_test_nonprod_only','st71_test_nonprod_only','localhost','127.0.0.1','0.0.0.0','YOUR_PASSWORD','PROJECT_REF','pooler-host','db-host']
const ALLOWED_FILES = new Set(['tests/st70-sorting-cancellation-history.test.ts','tests/st27-credential-scan.test.ts','scripts/security/scan-credentials.mjs'])

function isAllowed(match) { return ALLOWED_SUBSTRINGS.some(sub => match.includes(sub)) }
function isFileAllowed(filename) { return ALLOWED_FILES.has(filename) }
function findViolations(content, filename = '') {
  if (isFileAllowed(filename)) return []
  const matches = content.match(CREDENTIAL_URL_PATTERN) || []
  return matches.filter(m => !isAllowed(m))
}

describe('ST-27 credential pattern detection', () => {
  test('1. embedded production-like credential is rejected', () => {
    expect(findViolations(`const url = 'postgresql://postgres.prod-ref:realPassword123@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres'`)).toHaveLength(1)
  })
  test('2. real hostname + embedded password is rejected', () => {
    expect(findViolations(`const x = 'postgres://admin:s3cret@db.production.example.com:5432/mydb'`)).toHaveLength(1)
  })
  test('3. percent-encoded password is detected', () => {
    expect(findViolations(`const url = 'postgresql://user:p%40ssw0rd@host.example.com:5432/db'`)).toHaveLength(1)
  })
  test('4. placeholder passes (YOUR_PASSWORD)', () => {
    expect(findViolations(`SUPABASE_POOLER_URL=postgresql://postgres.PROJECT_REF:YOUR_PASSWORD@pooler-host:6543/postgres`)).toHaveLength(0)
  })
  test('5. approved CI fixture passes', () => {
    expect(findViolations(`DATABASE_URL: postgresql://st62_test:st62_test_nonprod_only@localhost:5432/st62_idempotency_test`)).toHaveLength(0)
  })
  test('6. localhost fixture passes', () => {
    expect(findViolations(`const url = 'postgresql://postgres:postgres@localhost:5432/test'`)).toHaveLength(0)
  })
  test('7. file-level allowlist: st70 test fixture file is skipped', () => {
    expect(findViolations(`const err = new Error('connection string postgres://user:pass@host:5432')`, 'tests/st70-sorting-cancellation-history.test.ts')).toHaveLength(0)
  })
  test('8. file-level allowlist does NOT apply to other files', () => {
    expect(findViolations(`const err = new Error('connection string postgres://user:pass@host:5432')`, 'some/other/file.ts')).toHaveLength(1)
  })
  test('9. env-based configuration passes', () => {
    expect(findViolations(`const url = process.env.DATABASE_URL`)).toHaveLength(0)
  })
  test('10. requireDbUrl pattern passes', () => {
    expect(findViolations(`import { requireDbUrl } from '../scripts/lib/require-db-url.mjs'\nconst url = requireDbUrl('SUPABASE_POOLER_URL')`)).toHaveLength(0)
  })
})

describe('ST-27 scanner output safety', () => {
  test('11. scanner output does not reveal matched value', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/security/scan-credentials.mjs'), 'utf8')
    expect(src).toContain('v.file')
    expect(src).toContain('v.category')
    expect(src).not.toMatch(/console\.\w+\(.*match/i)
  })
})

describe('ST-27 full scanner integration', () => {
  let tempRepo: string
  beforeEach(() => { tempRepo = mkdtempSync(join(tmpdir(), 'st27-')) })
  afterEach(() => { try { rmSync(tempRepo, { recursive: true, force: true }) } catch {} })
  test('12. scanner detects violation in tracked file', () => {
    execSync('git init -q', { cwd: tempRepo })
    writeFileSync(join(tempRepo, 'evil.ts'), `const url = 'postgresql://postgres.real:hardcodedPass@prod.supabase.co:6543/db'`)
    execSync('git add -A && git commit -q -m test', { cwd: tempRepo })
    let exitCode = 0
    try { execSync(`bun ${join(process.cwd(), 'scripts/security/scan-credentials.mjs')}`, { cwd: tempRepo, stdio: 'pipe' }) }
    catch (e) { exitCode = (e as { status?: number }).status ?? 1 }
    expect(exitCode).toBe(1)
  })
  test('13. scanner ignores untracked files', () => {
    execSync('git init -q', { cwd: tempRepo })
    writeFileSync(join(tempRepo, 'untracked.ts'), `const url = 'postgresql://p:r@prod.supabase.co:6543/db'`)
    writeFileSync(join(tempRepo, 'clean.ts'), `const x = 1`)
    execSync('git add clean.ts && git commit -q -m t', { cwd: tempRepo })
    let exitCode = 0
    try { execSync(`bun ${join(process.cwd(), 'scripts/security/scan-credentials.mjs')}`, { cwd: tempRepo, stdio: 'pipe' }) }
    catch (e) { exitCode = (e as { status?: number }).status ?? 1 }
    expect(exitCode).toBe(0)
  })
  test('14. binary files do not break scanner', () => {
    execSync('git init -q', { cwd: tempRepo })
    writeFileSync(join(tempRepo, 'binary.bin'), Buffer.from([0x00, 0x01, 0xff]))
    writeFileSync(join(tempRepo, 'clean.ts'), `const x = 1`)
    execSync('git add -A && git commit -q -m t', { cwd: tempRepo })
    let exitCode = 0
    try { execSync(`bun ${join(process.cwd(), 'scripts/security/scan-credentials.mjs')}`, { cwd: tempRepo, stdio: 'pipe' }) }
    catch (e) { exitCode = (e as { status?: number }).status ?? 1 }
    expect(exitCode).toBe(0)
  })
})

describe('ST-27 fail-closed credential loader', () => {
  test('15. throws when env var missing', async () => {
    const { requireDbUrl } = await import('../scripts/lib/require-db-url.mjs')
    delete process.env.TEST_MISSING_URL
    expect(() => requireDbUrl('TEST_MISSING_URL')).toThrow('TEST_MISSING_URL')
  })
  test('16. throws when not postgres protocol', async () => {
    const { requireDbUrl } = await import('../scripts/lib/require-db-url.mjs')
    process.env.TEST_BAD_PROTO = 'http://localhost:5432'
    expect(() => requireDbUrl('TEST_BAD_PROTO')).toThrow('postgres')
    delete process.env.TEST_BAD_PROTO
  })
  test('17. accepts postgresql://', async () => {
    const { requireDbUrl } = await import('../scripts/lib/require-db-url.mjs')
    process.env.TEST_GOOD_URL = 'postgresql://user:pass@localhost:5432/db'
    expect(requireDbUrl('TEST_GOOD_URL')).toBe('postgresql://user:pass@localhost:5432/db')
    delete process.env.TEST_GOOD_URL
  })
  test('18. accepts postgres://', async () => {
    const { requireDbUrl } = await import('../scripts/lib/require-db-url.mjs')
    process.env.TEST_GOOD_URL2 = 'postgres://user:pass@localhost:5432/db'
    expect(requireDbUrl('TEST_GOOD_URL2')).toBe('postgres://user:pass@localhost:5432/db')
    delete process.env.TEST_GOOD_URL2
  })
  test('19. loader does not log URL', async () => {
    const src = readFileSync(join(process.cwd(), 'scripts/lib/require-db-url.mjs'), 'utf8')
    expect(src).not.toMatch(/console\.\w+\(.*url/i)
  })
  test('20. loader has no fallback/default URL', async () => {
    const src = readFileSync(join(process.cwd(), 'scripts/lib/require-db-url.mjs'), 'utf8')
    expect(src).not.toMatch(/['"]postgresql:\/\/[^:\s'"]+:[^@\s'"]+@/)
  })
})

describe('ST-27 write-authorization guard', () => {
  test('21. throws when URL missing even with ack', async () => {
    const { requireExplicitWriteApproval } = await import('../scripts/lib/require-db-url.mjs')
    delete process.env.TEST_WRITE_URL
    process.env.ALLOW_PRODUCTION_WRITE = 'I_UNDERSTAND_THIS_WRITES_PRODUCTION'
    expect(() => requireExplicitWriteApproval('TEST_WRITE_URL')).toThrow('TEST_WRITE_URL')
    delete process.env.ALLOW_PRODUCTION_WRITE
  })
  test('22. throws when URL present but ack missing', async () => {
    const { requireExplicitWriteApproval } = await import('../scripts/lib/require-db-url.mjs')
    process.env.TEST_WRITE_URL2 = 'postgresql://user:pass@localhost:5432/db'
    delete process.env.ALLOW_PRODUCTION_WRITE
    expect(() => requireExplicitWriteApproval('TEST_WRITE_URL2')).toThrow('ALLOW_PRODUCTION_WRITE')
    delete process.env.TEST_WRITE_URL2
  })
  test('23. throws when ack does not match exact phrase', async () => {
    const { requireExplicitWriteApproval } = await import('../scripts/lib/require-db-url.mjs')
    process.env.TEST_WRITE_URL3 = 'postgresql://user:pass@localhost:5432/db'
    process.env.ALLOW_PRODUCTION_WRITE = 'yes'
    expect(() => requireExplicitWriteApproval('TEST_WRITE_URL3')).toThrow('must be exactly')
    delete process.env.TEST_WRITE_URL3
    delete process.env.ALLOW_PRODUCTION_WRITE
  })
  test('24. accepts when both URL and exact ack present', async () => {
    const { requireExplicitWriteApproval } = await import('../scripts/lib/require-db-url.mjs')
    process.env.TEST_WRITE_URL4 = 'postgresql://user:pass@localhost:5432/db'
    process.env.ALLOW_PRODUCTION_WRITE = 'I_UNDERSTAND_THIS_WRITES_PRODUCTION'
    expect(requireExplicitWriteApproval('TEST_WRITE_URL4')).toBe('postgresql://user:pass@localhost:5432/db')
    delete process.env.TEST_WRITE_URL4
    delete process.env.ALLOW_PRODUCTION_WRITE
  })
  test('25. read-only requireDbUrl does NOT require ack', async () => {
    const { requireDbUrl } = await import('../scripts/lib/require-db-url.mjs')
    process.env.TEST_READONLY_URL = 'postgresql://user:pass@localhost:5432/db'
    delete process.env.ALLOW_PRODUCTION_WRITE
    expect(requireDbUrl('TEST_READONLY_URL')).toBe('postgresql://user:pass@localhost:5432/db')
    delete process.env.TEST_READONLY_URL
  })
  test('26. write-guard error output does not reveal URL or password', async () => {
    const src = readFileSync(join(process.cwd(), 'scripts/lib/require-db-url.mjs'), 'utf8')
    expect(src).not.toMatch(/console\.\w+\(.*url/i)
    expect(src).not.toMatch(/console\.\w+\(.*password/i)
  })
  test('27. write-guard supports custom ack var + phrase', async () => {
    const { requireExplicitWriteApproval } = await import('../scripts/lib/require-db-url.mjs')
    process.env.TEST_WRITE_URL5 = 'postgresql://user:pass@localhost:5432/db'
    process.env.CUSTOM_ACK = 'CUSTOM_PHRASE_HERE'
    expect(requireExplicitWriteApproval('TEST_WRITE_URL5', { ackVar: 'CUSTOM_ACK', ackPhrase: 'CUSTOM_PHRASE_HERE' })).toBe('postgresql://user:pass@localhost:5432/db')
    delete process.env.TEST_WRITE_URL5
    delete process.env.CUSTOM_ACK
  })
})
