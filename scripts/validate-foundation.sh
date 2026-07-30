#!/usr/bin/env bash
# ST-71: Foundation validation for reliability foundation.
# Checks that required canonical files exist and have no obvious issues.
#
# Usage:
#   bash scripts/validate-foundation.sh           # validate current directory
#   bash scripts/validate-foundation.sh /path/to # validate a different root

set -euo pipefail

# Resolve script's own directory (before cd changes CWD)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve root directory: use first argument or default to script's parent
ROOT="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT"

echo "=== ST-71 Foundation Validation (root: $ROOT) ==="
FAILURES=0

# 1. Required canonical files exist
for f in \
  AGENTS.md \
  process/CURRENT_STATE.md \
  process/DEFINITION_OF_DONE.md \
  .github/pull_request_template.md \
  .github/workflows/production-smoke.yml; do
  if [ -f "$f" ]; then
    echo "  ✅ $f exists"
  else
    echo "  ❌ $f MISSING"
    FAILURES=$((FAILURES + 1))
  fi
done

# 2. CURRENT_STATE.md has an update date
if [ -f "process/CURRENT_STATE.md" ] && grep -q "Last updated:" process/CURRENT_STATE.md; then
  echo "  ✅ CURRENT_STATE.md has update date"
else
  echo "  ❌ CURRENT_STATE.md missing update date"
  FAILURES=$((FAILURES + 1))
fi

# 3. Smoke workflow has no hardcoded tokens/passwords
#    Check for credential patterns. Exclude lines referencing GitHub Actions
#    secrets, inputs, or env: declarations (which are safe variable references).
if [ -f ".github/workflows/production-smoke.yml" ]; then
  CRED_HITS=$(grep -iE 'ghp_[a-z0-9]{20,}' .github/workflows/production-smoke.yml 2>/dev/null | grep -v -E 'secret|input|env:|\$\{' || true)
  if [ -n "$CRED_HITS" ]; then
    echo "  ❌ Smoke workflow has hardcoded credentials"
    FAILURES=$((FAILURES + 1))
  else
    echo "  ✅ Smoke workflow has no hardcoded credentials"
  fi
else
  echo "  ⏭️  Smoke workflow not found (already reported above)"
fi

# 4. AGENTS.md references real files (check reading-order paths)
if [ -f "AGENTS.md" ]; then
  for ref in \
    "process/CURRENT_STATE.md" \
    "process/PROJECT_OPERATING_CONTEXT.md" \
    "process/BUSINESS_RULES.md" \
    "process/DATABASE_CONTEXT.md" \
    "process/DEFINITION_OF_DONE.md"; do
    if [ -f "$ref" ]; then
      echo "  ✅ AGENTS.md reference '$ref' exists"
    else
      echo "  ❌ AGENTS.md reference '$ref' MISSING"
      FAILURES=$((FAILURES + 1))
    fi
  done
else
  echo "  ⏭️  AGENTS.md not found (already reported above)"
fi

# 5. PR template has required sections
if [ -f ".github/pull_request_template.md" ]; then
  for section in "Linked Issue" "Goal and Bounded Scope" "Tests Added" "Production Verification Status" "Safety Checklist"; do
    if grep -q "$section" .github/pull_request_template.md; then
      echo "  ✅ PR template has '$section' section"
    else
      echo "  ❌ PR template missing '$section' section"
      FAILURES=$((FAILURES + 1))
    fi
  done
else
  echo "  ⏭️  PR template not found (already reported above)"
fi

# 6. Knowledge directory structure exists
for kf in \
  knowledge/README.md \
  knowledge/INDEX.md \
  knowledge/schema/knowledge-record.schema.json; do
  if [ -f "$kf" ]; then
    echo "  ✅ $kf exists"
  else
    echo "  ❌ $kf MISSING"
    FAILURES=$((FAILURES + 1))
  fi
done

# 7. At least one knowledge template exists
TEMPLATE_COUNT=$(find knowledge/templates -name "*.md" 2>/dev/null | wc -l)
if [ "$TEMPLATE_COUNT" -ge 1 ]; then
  echo "  ✅ Knowledge templates exist ($TEMPLATE_COUNT)"
else
  echo "  ❌ Knowledge templates MISSING (expected at least 1)"
  FAILURES=$((FAILURES + 1))
fi

# 8. Knowledge records have YAML frontmatter with required fields
RECORD_COUNT=0
BAD_RECORDS=0
for record in knowledge/incidents/*.md knowledge/invariants/*.md knowledge/decisions/*.md; do
  [ -f "$record" ] || continue
  RECORD_COUNT=$((RECORD_COUNT + 1))
  # Check for YAML frontmatter block
  if ! head -1 "$record" | grep -q '^---$'; then
    echo "  ❌ $record missing YAML frontmatter"
    BAD_RECORDS=$((BAD_RECORDS + 1))
    continue
  fi
  # Check for required fields in frontmatter
  FRONTMATTER=$(sed -n '/^---$/,/^---$/p' "$record" | head -n -1 | tail -n +2)
  for field in id type status area title date; do
    if ! echo "$FRONTMATTER" | grep -q "^${field}:"; then
      echo "  ❌ $record missing required field '$field' in frontmatter"
      BAD_RECORDS=$((BAD_RECORDS + 1))
    fi
  done
done
if [ $BAD_RECORDS -gt 0 ]; then
  FAILURES=$((FAILURES + 1))
elif [ $RECORD_COUNT -gt 0 ]; then
  echo "  ✅ Knowledge records validated ($RECORD_COUNT records, all have required frontmatter)"
else
  echo "  ✅ Knowledge records directory exists (no records yet — OK)"
fi

# 9. Knowledge semantic validation (unique IDs, type/status, INDEX consistency, etc.)
#    Uses the validator from the script's own repository location, not the fixture root.
SEMANTIC_VALIDATOR="$SCRIPT_DIR/validate-knowledge.mjs"
if command -v node &>/dev/null && [ -f "$SEMANTIC_VALIDATOR" ]; then
  node "$SEMANTIC_VALIDATOR" "$ROOT"
  SEMANTIC_EXIT=$?
  if [ $SEMANTIC_EXIT -eq 0 ]; then
    echo "  ✅ Knowledge semantic validation passed"
  else
    echo "  ❌ Knowledge semantic validation failed"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "  ⏭️  Knowledge semantic validation skipped (node or validator not available)"
fi

echo ""
if [ $FAILURES -eq 0 ]; then
  echo "=== ALL CHECKS PASSED ✅ ==="
  exit 0
else
  echo "=== $FAILURES CHECK(S) FAILED ❌ ==="
  exit 1
fi
