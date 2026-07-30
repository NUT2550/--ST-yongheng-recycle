#!/usr/bin/env bash
# ST-71: Minimal policy validation for reliability foundation.
# Checks that required canonical files exist and have no obvious issues.
# Run: bash scripts/validate-foundation.sh

set -e

echo "=== ST-71 Foundation Validation ==="
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
if grep -q "Last updated:" process/CURRENT_STATE.md; then
  echo "  ✅ CURRENT_STATE.md has update date"
else
  echo "  ❌ CURRENT_STATE.md missing update date"
  FAILURES=$((FAILURES + 1))
fi

# 3. Smoke workflow has no hardcoded tokens/passwords
if grep -iE "ghp_[a-z0-9]{20,}|password.*=.*[a-z0-9]{8}|jwt_secret.*=.*[a-z0-9]{20}" .github/workflows/production-smoke.yml | grep -v "secret\|input\|env"; then
  echo "  ❌ Smoke workflow has hardcoded credentials"
  FAILURES=$((FAILURES + 1))
else
  echo "  ✅ Smoke workflow has no hardcoded credentials"
fi

# 4. AGENTS.md references real files
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

# 5. PR template has required sections
for section in "Linked Issue" "Goal and Bounded Scope" "Tests Added" "Production Verification Status" "Safety Checklist"; do
  if grep -q "$section" .github/pull_request_template.md; then
    echo "  ✅ PR template has '$section' section"
  else
    echo "  ❌ PR template missing '$section' section"
    FAILURES=$((FAILURES + 1))
  fi
done

echo ""
if [ $FAILURES -eq 0 ]; then
  echo "=== ALL CHECKS PASSED ✅ ==="
  exit 0
else
  echo "=== $FAILURES CHECK(S) FAILED ❌ ==="
  exit 1
fi
