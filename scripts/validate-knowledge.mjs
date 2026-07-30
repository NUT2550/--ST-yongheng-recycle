#!/usr/bin/env node
/**
 * ST-71: Semantic knowledge record validator.
 *
 * Invoked by scripts/validate-foundation.sh after structural checks.
 * Validates frontmatter, schema, identity, type/directory, status,
 * dates, INDEX consistency, source references, content sections,
 * credential scanning, and supersession rules.
 *
 * Usage: node scripts/validate-knowledge.mjs [root-dir]
 * Exit: 0 = all pass, 1 = failures found
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve, basename, dirname, relative } from 'path';

const ROOT = resolve(process.argv[2] || process.cwd());
const KNOWLEDGE_DIR = join(ROOT, 'knowledge');

let failures = 0;
const errors = [];

function fail(msg) {
  errors.push(msg);
  failures++;
}

// --- Phase 3: Front-matter parser (bounded, no eval) ---
function parseFrontmatter(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { ok: false, error: 'missing YAML frontmatter opening ---', content };
  }
  const endIdx = content.indexOf('\n---\n', 4) !== -1
    ? content.indexOf('\n---\n', 4)
    : content.indexOf('\r\n---\r\n', 4);
  if (endIdx === -1) {
    return { ok: false, error: 'missing YAML frontmatter closing ---', content };
  }
  const yamlText = content.substring(4, endIdx).trim();
  const body = content.substring(endIdx + 5).trim();
  
  // Bounded YAML parser for our flat key-value format
  const meta = {};
  const lines = yamlText.split('\n');
  let currentListKey = null;
  const seenKeys = new Set();
  
  for (const line of lines) {
    if (line.trim() === '') continue;
    
    // List item under a key
    if (line.startsWith('  - ') && currentListKey) {
      if (!Array.isArray(meta[currentListKey])) {
        meta[currentListKey] = [];
      }
      meta[currentListKey].push(line.substring(4).trim());
      continue;
    }
    
    // Key: value
    const kvMatch = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();
      
      // Detect duplicate keys
      if (seenKeys.has(key)) {
        return { ok: false, error: `duplicate YAML key '${key}'`, content };
      }
      seenKeys.add(key);
      
      currentListKey = key;
      if (value !== '') {
        meta[key] = value;
      }
      // If value is empty, it might be a list (next lines with - )
      continue;
    }
    
    // Unparseable line
    return { ok: false, error: `unparseable YAML line: ${line}`, content };
  }
  
  return { ok: true, meta, body, content };
}

// --- Phase 4: Schema validation ---
const ALLOWED_TYPES = ['incident', 'invariant', 'decision'];
const ALLOWED_STATUSES = ['verified', 'active', 'superseded'];
const ID_PATTERN = /^(ERR|INV|DEC)-ST[0-9]+-[A-Z0-9-]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TYPE_TO_DIR = {
  incident: 'incidents',
  invariant: 'invariants',
  decision: 'decisions',
};

// Content section requirements by type
const REQUIRED_SECTIONS = {
  incident: ['Symptom', 'Root Cause', 'Fix', 'Regression Test'],
  invariant: ['Invariant Statement', 'Rationale', 'Enforcement'],
  decision: ['Decision', 'Context', 'Rationale'],
};

// Credential patterns (never print matched value)
const CRED_PATTERNS = [
  /ghp_[a-fA-F0-9]{36}/,
  /sk-[a-zA-Z0-9]{48}/,
  /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /[a-zA-Z_]+(?:password|secret|token)[a-zA-Z_]*\s*[:=]\s*['"][^'"]{8,}['"]/i,
];
// Synthetic placeholders that are always allowed
const SYNTHETIC_ALLOW = /REDACTED|example|template|placeholder|abc123|STXX/i;

function validateCredentialScan(filePath, content) {
  for (const pattern of CRED_PATTERNS) {
    const match = content.match(pattern);
    if (match && !SYNTHETIC_ALLOW.test(match[0])) {
      fail(`  ❌ ${relative(ROOT, filePath)}: credential pattern detected (value redacted)`);
      return;
    }
  }
}

function validateDate(dateStr, fieldName, filePath) {
  if (!DATE_PATTERN.test(dateStr)) {
    fail(`  ❌ ${relative(ROOT, filePath)}: ${fieldName} '${dateStr}' does not match YYYY-MM-DD`);
    return false;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    fail(`  ❌ ${relative(ROOT, filePath)}: ${fieldName} '${dateStr}' is not a real calendar date`);
    return false;
  }
  return true;
}

// --- Collect all records ---
const recordDirs = ['incidents', 'invariants', 'decisions'];
const records = [];
const allIds = new Map(); // id -> filePath
const supersededBy = new Map(); // id -> superseded_by value

for (const dir of recordDirs) {
  const dirPath = join(KNOWLEDGE_DIR, dir);
  if (!existsSync(dirPath)) continue;
  
  const files = readdirSync(dirPath).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = join(dirPath, file);
    const relPath = relative(ROOT, filePath);
    const stem = file.replace(/\.md$/, '');
    
    // Parse frontmatter
    const parsed = parseFrontmatter(filePath);
    if (!parsed.ok) {
      fail(`  ❌ ${relPath}: ${parsed.error}`);
      continue;
    }
    
    const { meta, body, content } = parsed;
    
    // Credential scan
    validateCredentialScan(filePath, content);
    
    // Required fields
    for (const field of ['id', 'type', 'status', 'area', 'title', 'date']) {
      if (!meta[field]) {
        fail(`  ❌ ${relPath}: missing required field '${field}'`);
      }
    }
    
    // ID pattern
    if (meta.id && !ID_PATTERN.test(meta.id)) {
      fail(`  ❌ ${relPath}: id '${meta.id}' does not match pattern ^(ERR|INV|DEC)-ST[0-9]+-[A-Z0-9-]+$`);
    }
    
    // ID uniqueness
    if (meta.id) {
      if (allIds.has(meta.id)) {
        fail(`  ❌ ${relPath}: duplicate id '${meta.id}' (also in ${relative(ROOT, allIds.get(meta.id))})`);
      } else {
        allIds.set(meta.id, filePath);
      }
    }
    
    // Filename = ID
    if (meta.id && stem !== meta.id) {
      fail(`  ❌ ${relPath}: filename '${stem}' does not match id '${meta.id}'`);
    }
    
    // Type validation
    if (meta.type && !ALLOWED_TYPES.includes(meta.type)) {
      fail(`  ❌ ${relPath}: invalid type '${meta.type}' (allowed: ${ALLOWED_TYPES.join(', ')})`);
    }
    
    // Type/directory consistency
    if (meta.type && TYPE_TO_DIR[meta.type] && dir !== TYPE_TO_DIR[meta.type]) {
      fail(`  ❌ ${relPath}: type '${meta.type}' should be in '${TYPE_TO_DIR[meta.type]}/' not '${dir}/'`);
    }
    
    // Status validation
    if (meta.status && !ALLOWED_STATUSES.includes(meta.status)) {
      fail(`  ❌ ${relPath}: invalid status '${meta.status}' (allowed: ${ALLOWED_STATUSES.join(', ')})`);
    }
    
    // Supersession rules
    if (meta.status === 'superseded') {
      if (!meta.superseded_by) {
        fail(`  ❌ ${relPath}: status 'superseded' requires 'superseded_by' field`);
      } else {
        supersededBy.set(meta.id, meta.superseded_by);
        if (meta.superseded_by === meta.id) {
          fail(`  ❌ ${relPath}: self-supersession (id = superseded_by)`);
        }
      }
    }
    
    // Date validation
    if (meta.date) {
      validateDate(meta.date, 'date', filePath);
    }
    if (meta.updated) {
      validateDate(meta.updated, 'updated', filePath);
      if (meta.date && meta.updated) {
        if (new Date(meta.updated) < new Date(meta.date)) {
          fail(`  ❌ ${relPath}: updated '${meta.updated}' is before date '${meta.date}'`);
        }
      }
    }
    
    // Content section validation
    if (meta.type && REQUIRED_SECTIONS[meta.type]) {
      for (const section of REQUIRED_SECTIONS[meta.type]) {
        if (!body.includes(`## ${section}`)) {
          fail(`  ❌ ${relPath}: missing required section '## ${section}'`);
        }
      }
    }
    
    // Source file reference validation (optional field: source_files)
    if (meta.source_files) {
      const files = Array.isArray(meta.source_files) ? meta.source_files : [meta.source_files];
      for (const srcFile of files) {
        const srcPath = join(ROOT, srcFile);
        if (!existsSync(srcPath)) {
          fail(`  ❌ ${relPath}: source_files reference '${srcFile}' does not exist`);
        }
      }
    }
    
    records.push({ filePath, relPath, meta, body, stem, dir });
  }
}

// --- Phase: Supersession cycle detection (2-record cycles) ---
for (const [id, target] of supersededBy) {
  if (supersededBy.has(target) && supersededBy.get(target) === id) {
    fail(`  ❌ supersession cycle: '${id}' → '${target}' → '${id}'`);
  }
  // Target must exist
  if (!allIds.has(target)) {
    fail(`  ❌ superseded_by target '${target}' does not exist (referenced by ${id})`);
  }
}

// --- Phase 4: Schema JSON validation ---
const schemaPath = join(KNOWLEDGE_DIR, 'schema', 'knowledge-record.schema.json');
if (existsSync(schemaPath)) {
  try {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    // Validate schema structure
    if (!schema.required || !Array.isArray(schema.required)) {
      fail(`  ❌ schema: missing or invalid 'required' array`);
    } else {
      // Check schema required fields match our validator
      const expectedRequired = ['id', 'type', 'status', 'area', 'title', 'date'];
      for (const field of expectedRequired) {
        if (!schema.required.includes(field)) {
          fail(`  ❌ schema: required field '${field}' missing from schema.required`);
        }
      }
    }
    // Check enums match
    const typeEnum = schema.properties?.type?.enum;
    if (typeEnum && JSON.stringify(typeEnum) !== JSON.stringify(ALLOWED_TYPES)) {
      fail(`  ❌ schema: type enum mismatch (schema: ${typeEnum}, validator: ${ALLOWED_TYPES})`);
    }
    const statusEnum = schema.properties?.status?.enum;
    if (statusEnum && JSON.stringify(statusEnum) !== JSON.stringify(ALLOWED_STATUSES)) {
      fail(`  ❌ schema: status enum mismatch (schema: ${statusEnum}, validator: ${ALLOWED_STATUSES})`);
    }
  } catch (e) {
    fail(`  ❌ schema: invalid JSON: ${e.message}`);
  }
}

// --- Phase 6: INDEX consistency ---
const indexPath = join(KNOWLEDGE_DIR, 'INDEX.md');
if (existsSync(indexPath)) {
  const indexContent = readFileSync(indexPath, 'utf-8');
  const indexEntries = new Map(); // id -> { title, area, status, type }
  const indexPaths = new Set();
  
  // Parse INDEX markdown tables
  const lines = indexContent.split('\n');
  let currentSection = null;
  
  for (const line of lines) {
    // Detect section headers
    if (line.startsWith('## Incidents')) currentSection = 'incident';
    else if (line.startsWith('## Invariants')) currentSection = 'invariant';
    else if (line.startsWith('## Decisions')) currentSection = 'decision';
    
    // Parse table rows (skip header + separator)
    if (line.startsWith('| ') && !line.includes('---') && !line.match(/^\| ID \|/)) {
      const cols = line.split('|').map(c => c.trim()).filter(c => c !== '');
      if (cols.length >= 2) {
        const id = cols[0];
        const title = cols[1];
        const area = cols.length > 2 ? cols[2] : '';
        
        // Check for duplicate INDEX entries
        if (indexEntries.has(id)) {
          fail(`  ❌ INDEX: duplicate id '${id}'`);
        }
        
        indexEntries.set(id, { title, area, type: currentSection, line });
      }
    }
  }
  
  // Check: every record appears in INDEX
  for (const record of records) {
    if (!indexEntries.has(record.meta.id)) {
      fail(`  ❌ INDEX: record '${record.meta.id}' (${record.relPath}) missing from INDEX`);
    }
  }
  
  // Check: every INDEX entry has a matching record
  for (const [id, entry] of indexEntries) {
    if (!allIds.has(id)) {
      fail(`  ❌ INDEX: id '${id}' does not match any record file`);
    }
  }
  
  // Check: INDEX title matches record title
  for (const record of records) {
    const indexEntry = indexEntries.get(record.meta.id);
    if (indexEntry && indexEntry.title !== record.meta.title) {
      fail(`  ❌ INDEX: title mismatch for '${record.meta.id}' (INDEX: '${indexEntry.title}', record: '${record.meta.title}')`);
    }
  }
  
  // Check: INDEX area matches record area
  for (const record of records) {
    const indexEntry = indexEntries.get(record.meta.id);
    if (indexEntry && indexEntry.area !== record.meta.area) {
      fail(`  ❌ INDEX: area mismatch for '${record.meta.id}' (INDEX: '${indexEntry.area}', record: '${record.meta.area}')`);
    }
  }
} else {
  fail(`  ❌ knowledge/INDEX.md not found`);
}

// --- Report ---
console.log('=== ST-71 Knowledge Semantic Validation ===');
if (failures === 0) {
  console.log(`  ✅ All ${records.length} records validated (semantic, index, schema, credentials)`);
  console.log('=== ALL CHECKS PASSED ✅ ===');
  process.exit(0);
} else {
  for (const err of errors) {
    console.log(err);
  }
  console.log(`=== ${failures} CHECK(S) FAILED ❌ ===`);
  process.exit(1);
}
