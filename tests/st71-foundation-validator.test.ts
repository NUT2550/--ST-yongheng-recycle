/**
 * ST-71: Regression tests for scripts/validate-foundation.sh
 *
 * These tests create isolated temporary fixture directories, run the validator
 * against them, and verify the exit code and output. They never modify the
 * real repository working tree.
 *
 * The validator accepts an optional root-directory argument:
 *   bash scripts/validate-foundation.sh /path/to/fixture
 */

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const VALIDATOR_PATH = join(process.cwd(), 'scripts', 'validate-foundation.sh')

/** Create a fixture directory with a valid foundation. */
function createValidFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'st71-valid-'))
  mkdirSync(join(dir, 'process'), { recursive: true })
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })

  writeFileSync(join(dir, 'AGENTS.md'), [
    '# AGENTS.md',
    '',
    '> Read this file first.',
    '',
    '## Required Reading Order',
    '1. AGENTS.md',
    '2. process/CURRENT_STATE.md',
    '3. process/PROJECT_OPERATING_CONTEXT.md',
    '4. process/BUSINESS_RULES.md',
    '5. process/DATABASE_CONTEXT.md',
    '6. process/DEFINITION_OF_DONE.md',
    '',
  ].join('\n'))

  writeFileSync(join(dir, 'process', 'CURRENT_STATE.md'), [
    '# Current State',
    '',
    '> Last updated: 2026-07-30',
    '',
    'Some content.',
    '',
  ].join('\n'))

  writeFileSync(join(dir, 'process', 'DEFINITION_OF_DONE.md'), '# Definition of Done\n')
  writeFileSync(join(dir, 'process', 'PROJECT_OPERATING_CONTEXT.md'), '# Project Operating Context\n')
  writeFileSync(join(dir, 'process', 'BUSINESS_RULES.md'), '# Business Rules\n')
  writeFileSync(join(dir, 'process', 'DATABASE_CONTEXT.md'), '# Database Context\n')

  writeFileSync(join(dir, '.github', 'pull_request_template.md'), [
    '## Linked Issue',
    '## Goal and Bounded Scope',
    '## Tests Added',
    '## Production Verification Status',
    '## Safety Checklist',
    '',
  ].join('\n'))

  writeFileSync(join(dir, '.github', 'workflows', 'production-smoke.yml'), [
    'name: Production Smoke Test',
    'on:',
    '  workflow_dispatch:',
    '',
  ].join('\n'))

  // Knowledge directory
  mkdirSync(join(dir, 'knowledge', 'schema'), { recursive: true })
  mkdirSync(join(dir, 'knowledge', 'templates'), { recursive: true })
  mkdirSync(join(dir, 'knowledge', 'incidents'), { recursive: true })
  mkdirSync(join(dir, 'knowledge', 'invariants'), { recursive: true })
  mkdirSync(join(dir, 'knowledge', 'decisions'), { recursive: true })

  writeFileSync(join(dir, 'knowledge', 'README.md'), '# Knowledge Directory\n')
  writeFileSync(join(dir, 'knowledge', 'INDEX.md'), [
    '# Knowledge Index',
    '',
    '## Incidents',
    '',
    '| ID | Title | Area | Root Cause | Status |',
    '|---|---|---|---|---|',
    '| ERR-ST00-TEST | Test Incident | test | Test root cause | verified |',
    '',
    '## Invariants',
    '',
    '| ID | Title | Area | Enforced By |',
    '|---|---|---|---|',
    '',
    '## Decisions',
    '',
    '| ID | Title | Area | Rationale |',
    '|---|---|---|---|',
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'knowledge', 'schema', 'knowledge-record.schema.json'), JSON.stringify({
    required: ['id', 'type', 'status', 'area', 'title', 'date'],
    properties: {
      type: { enum: ['incident', 'invariant', 'decision'] },
      status: { enum: ['verified', 'active', 'superseded'] },
    }
  }) + '\n')
  writeFileSync(join(dir, 'knowledge', 'templates', 'incident.md'), '---\nid: ERR-ST00-TEMPLATE\ntype: incident\nstatus: verified\narea: test\ntitle: Template\ndate: 2026-01-01\n---\n\n## Symptom\n## Root Cause\n## Fix\n## Regression Test\n')
  // Create a valid record
  writeFileSync(join(dir, 'knowledge', 'incidents', 'ERR-ST00-TEST.md'), [
    '---',
    'id: ERR-ST00-TEST',
    'type: incident',
    'status: verified',
    'area: test',
    'title: Test Incident',
    'date: 2026-01-01',
    '---',
    '',
    '## Symptom',
    'Test symptom.',
    '',
    '## Root Cause',
    'Test root cause.',
    '',
    '## Fix',
    'Test fix.',
    '',
    '## Regression Test',
    'Test regression.',
    '',
  ].join('\n'))

  return dir
}

/** Run the validator against a fixture directory. Returns { exitCode, stdout, stderr }. */
async function runValidator(fixtureDir: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bash', VALIDATOR_PATH, fixtureDir], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited
  return { exitCode, stdout, stderr }
}

/** Run validator and assert it fails with a specific error message. */
async function expectValidatorFails(fixtureDir: string, expectedMessage: string) {
  const { exitCode, stdout } = await runValidator(fixtureDir)
  expect(exitCode).not.toBe(0)
  expect(stdout).toContain(expectedMessage)
}

describe('ST-71 foundation validator — regression tests', () => {
  let validFixture: string
  let fixtures: string[] = []

  test('setup: valid fixture passes', async () => {
    validFixture = createValidFixture()
    fixtures.push(validFixture)
    const { exitCode, stdout } = await runValidator(validFixture)
    expect(exitCode).toBe(0)
    expect(stdout).toContain('ALL CHECKS PASSED')
  })

  test('1. missing AGENTS.md → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    rmSync(join(dir, 'AGENTS.md'))
    await expectValidatorFails(dir, 'AGENTS.md MISSING')
  })

  test('2. missing process/CURRENT_STATE.md → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    rmSync(join(dir, 'process', 'CURRENT_STATE.md'))
    await expectValidatorFails(dir, 'process/CURRENT_STATE.md MISSING')
  })

  test('3. missing process/DEFINITION_OF_DONE.md → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    rmSync(join(dir, 'process', 'DEFINITION_OF_DONE.md'))
    await expectValidatorFails(dir, 'process/DEFINITION_OF_DONE.md MISSING')
  })

  test('4. missing PR template → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    rmSync(join(dir, '.github', 'pull_request_template.md'))
    await expectValidatorFails(dir, 'pull_request_template.md MISSING')
  })

  test('5. missing production-smoke workflow → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    rmSync(join(dir, '.github', 'workflows', 'production-smoke.yml'))
    await expectValidatorFails(dir, 'production-smoke.yml MISSING')
  })

  test('6. CURRENT_STATE missing update date → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    writeFileSync(join(dir, 'process', 'CURRENT_STATE.md'), '# Current State\n\nNo date here.\n')
    await expectValidatorFails(dir, 'CURRENT_STATE.md missing update date')
  })

  test('7. AGENTS reading-order path does not exist → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    rmSync(join(dir, 'process', 'BUSINESS_RULES.md'))
    await expectValidatorFails(dir, "AGENTS.md reference 'process/BUSINESS_RULES.md' MISSING")
  })

  test('8. PR template missing a required safety section → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    writeFileSync(join(dir, '.github', 'pull_request_template.md'), [
      '## Linked Issue',
      '## Goal and Bounded Scope',
      '## Tests Added',
      // Missing: Production Verification Status
      '## Safety Checklist',
      '',
    ].join('\n'))
    await expectValidatorFails(dir, "PR template missing 'Production Verification Status' section")
  })

  test('9. smoke workflow contains a hardcoded credential pattern → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    writeFileSync(join(dir, '.github', 'workflows', 'production-smoke.yml'), [
      'name: Production Smoke Test',
      'on:',
      '  workflow_dispatch:',
      'env:',
      '  GITHUB_TOKEN: ghp_abcdefghijklmnopqrstuvwxyz1234',
      '',
    ].join('\n'))
    await expectValidatorFails(dir, 'Smoke workflow has hardcoded credentials')
  })

  test('10. valid repository foundation → pass', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    const { exitCode, stdout } = await runValidator(dir)
    expect(exitCode).toBe(0)
    expect(stdout).toContain('ALL CHECKS PASSED')
  })

  test('11. missing knowledge/README.md → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    rmSync(join(dir, 'knowledge', 'README.md'))
    await expectValidatorFails(dir, 'knowledge/README.md MISSING')
  })

  test('12. missing knowledge/INDEX.md → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    rmSync(join(dir, 'knowledge', 'INDEX.md'))
    await expectValidatorFails(dir, 'knowledge/INDEX.md MISSING')
  })

  test('13. missing knowledge schema → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    rmSync(join(dir, 'knowledge', 'schema', 'knowledge-record.schema.json'))
    await expectValidatorFails(dir, 'knowledge-record.schema.json MISSING')
  })

  test('14. knowledge record missing YAML frontmatter → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    mkdirSync(join(dir, 'knowledge', 'incidents'), { recursive: true })
    writeFileSync(join(dir, 'knowledge', 'incidents', 'bad-record.md'), 'No frontmatter here\n')
    await expectValidatorFails(dir, 'missing YAML frontmatter')
  })

  test('15. knowledge record missing required field → fail', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    mkdirSync(join(dir, 'knowledge', 'incidents'), { recursive: true })
    writeFileSync(join(dir, 'knowledge', 'incidents', 'bad-record.md'), [
      '---',
      'id: ERR-ST00-TEST',
      'type: incident',
      // Missing: status, area, title, date
      '---',
      '',
    ].join('\n'))
    await expectValidatorFails(dir, "missing required field 'status'")
  })

  test('16. duplicate record ID → fail (semantic)', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    writeFileSync(join(dir, 'knowledge', 'incidents', 'ERR-ST00-DUP.md'), [
      '---', 'id: ERR-ST00-TEST', 'type: incident', 'status: verified',
      'area: test', 'title: Dup', 'date: 2026-01-01', '---',
      '## Symptom\n## Root Cause\n## Fix\n## Regression Test\n',
    ].join('\n'))
    await expectValidatorFails(dir, 'duplicate id')
  })

  test('17. invalid type value → fail (semantic)', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    writeFileSync(join(dir, 'knowledge', 'incidents', 'ERR-ST00-TEST.md'), [
      '---', 'id: ERR-ST00-TEST', 'type: bogus', 'status: verified',
      'area: test', 'title: Test', 'date: 2026-01-01', '---',
      '## Symptom\n## Root Cause\n## Fix\n## Regression Test\n',
    ].join('\n'))
    await expectValidatorFails(dir, "invalid type 'bogus'")
  })

  test('18. record missing from INDEX → fail (semantic)', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    writeFileSync(join(dir, 'knowledge', 'incidents', 'ERR-ST00-ORPHAN.md'), [
      '---', 'id: ERR-ST00-ORPHAN', 'type: incident', 'status: verified',
      'area: test', 'title: Orphan', 'date: 2026-01-01', '---',
      '## Symptom\n## Root Cause\n## Fix\n## Regression Test\n',
    ].join('\n'))
    await expectValidatorFails(dir, 'missing from INDEX')
  })

  test('19. INDEX title mismatch → fail (semantic)', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    writeFileSync(join(dir, 'knowledge', 'INDEX.md'), [
      '# Knowledge Index', '', '## Incidents', '',
      '| ID | Title | Area | Root Cause | Status |',
      '|---|---|---|---|---|',
      '| ERR-ST00-TEST | WRONG TITLE | test | Test root cause | verified |',
      '', '## Invariants', '', '| ID | Title | Area | Enforced By |', '|---|---|---|---|',
      '', '## Decisions', '', '| ID | Title | Area | Rationale |', '|---|---|---|---|',
      '',
    ].join('\n'))
    await expectValidatorFails(dir, 'title mismatch')
  })

  test('20. filename/ID mismatch → fail (semantic)', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    rmSync(join(dir, 'knowledge', 'incidents', 'ERR-ST00-TEST.md'))
    writeFileSync(join(dir, 'knowledge', 'incidents', 'wrong-name.md'), [
      '---', 'id: ERR-ST00-TEST', 'type: incident', 'status: verified',
      'area: test', 'title: Test Incident', 'date: 2026-01-01', '---',
      '## Symptom\n## Root Cause\n## Fix\n## Regression Test\n',
    ].join('\n'))
    await expectValidatorFails(dir, "filename 'wrong-name' does not match id")
  })

  test('21. invalid date format → fail (semantic)', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    writeFileSync(join(dir, 'knowledge', 'incidents', 'ERR-ST00-TEST.md'), [
      '---', 'id: ERR-ST00-TEST', 'type: incident', 'status: verified',
      'area: test', 'title: Test Incident', 'date: 2026-13-45', '---',
      '## Symptom\n## Root Cause\n## Fix\n## Regression Test\n',
    ].join('\n'))
    await expectValidatorFails(dir, 'not a real calendar date')
  })

  test('22. missing required content section → fail (semantic)', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    writeFileSync(join(dir, 'knowledge', 'incidents', 'ERR-ST00-TEST.md'), [
      '---', 'id: ERR-ST00-TEST', 'type: incident', 'status: verified',
      'area: test', 'title: Test Incident', 'date: 2026-01-01', '---',
      '## Symptom\n## Root Cause\n## Fix\n',
      // Missing: Regression Test
    ].join('\n'))
    await expectValidatorFails(dir, "missing required section '## Regression Test'")
  })

  test('23. valid foundation with semantic checks → pass', async () => {
    const dir = createValidFixture()
    fixtures.push(dir)
    const { exitCode, stdout } = await runValidator(dir)
    expect(exitCode).toBe(0)
    expect(stdout).toContain('ALL CHECKS PASSED')
  })

  test('cleanup: no mutation of source repository', () => {
    // Verify the real repository still has all files
    expect(existsSync('AGENTS.md')).toBe(true)
    expect(existsSync('process/CURRENT_STATE.md')).toBe(true)
    expect(existsSync('process/DEFINITION_OF_DONE.md')).toBe(true)
    expect(existsSync('.github/pull_request_template.md')).toBe(true)
    expect(existsSync('.github/workflows/production-smoke.yml')).toBe(true)
    expect(existsSync('scripts/validate-foundation.sh')).toBe(true)
    expect(existsSync('knowledge/README.md')).toBe(true)
    expect(existsSync('knowledge/INDEX.md')).toBe(true)
    expect(existsSync('knowledge/schema/knowledge-record.schema.json')).toBe(true)
  })

  // Cleanup all temp fixtures after all tests
  test('cleanup: remove temp fixtures', () => {
    for (const dir of fixtures) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
  })
})
