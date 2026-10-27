#!/usr/bin/env bash
# release-certify.sh - certify the CURRENT HEAD for release.
#
# A certification is a statement about one exact commit, so the script prints
# that SHA first and last, refuses a dirty working tree (a green run on
# uncommitted files certifies nothing that can be deployed), and checks at the
# end that HEAD did not move. It never installs, deploys, pushes or tags.
#
# Steps, in order:
#   tree        working tree and index are clean (nothing untracked, nothing modified)
#   install     npm ci                                  (only with --install)
#   lint        npm run lint
#   typecheck   npm run typecheck
#   test        full vitest suite (CI=1)
#   build       npm run build
#   audit       npm audit --audit-level=high --omit=dev (same gate as CI)
#   files       no prohibited file is tracked at HEAD; .gitignore keeps the required entries
#   secrets     custom regex scan of the commits in the range (see CERT_BASE)
#   gitleaks    gitleaks at the version pinned in .gitleaks-version, over the same range
#   guard-quick .github/pre-deploy-guard/scripts/quick-checks.sh
#   guard-full  .github/pre-deploy-guard/scripts/run-checks.sh (repeats lint/typecheck/test/build)
#   head        HEAD is still the certified SHA and the tree is still clean
#
# Exit status: 0 only when every step ran and passed (CERTIFIED). 1 if a step
# failed. 3 when the run was partial (--only/--skip), which is never a
# certification. 2 for usage errors.
#
# Environment:
#   CERT_BASE      commit-ish the release is measured from (default: upstream,
#                  origin/main, main, master, in that order). The secret scans
#                  cover CERT_BASE..HEAD; with no usable base they cover all history.
#   CERT_LOG_DIR   where step logs and the JSON summary are written (default: a new temp dir)
#   CERT_REPO      repository to certify (default: the repository this script lives in)
#
# Usage: scripts/release-certify.sh [--only a,b] [--skip a,b] [--install] [--dry-run]

set -uo pipefail

ALL_STEPS=(tree install lint typecheck test build audit files secrets gitleaks guard-quick guard-full head)
DEFAULT_OFF=(install)

usage() {
  sed -n '2,/^# Usage:/p' "$0" | sed 's/^# \{0,1\}//'
}

contains() {
  local needle="$1"; shift
  local item
  for item in "$@"; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

ONLY=""
SKIP=""
DRY_RUN=0
INSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only)    [ $# -ge 2 ] || { usage >&2; exit 2; }; ONLY="$2"; shift 2 ;;
    --skip)    [ $# -ge 2 ] || { usage >&2; exit 2; }; SKIP="$2"; shift 2 ;;
    --install) INSTALL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)         echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

IFS=',' read -r -a ONLY_LIST <<< "$ONLY"
IFS=',' read -r -a SKIP_LIST <<< "$SKIP"
for name in ${ONLY_LIST[@]+"${ONLY_LIST[@]}"} ${SKIP_LIST[@]+"${SKIP_LIST[@]}"}; do
  [ -z "$name" ] && continue
  contains "$name" "${ALL_STEPS[@]}" || { echo "unknown step: $name (steps: ${ALL_STEPS[*]})" >&2; exit 2; }
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${CERT_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT" 2>/dev/null || { echo "cannot enter $ROOT" >&2; exit 2; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "$ROOT is not a git repository" >&2; exit 2; }

SHA="$(git rev-parse HEAD 2>/dev/null)" || { echo "no commit to certify at HEAD" >&2; exit 2; }
SUBJECT="$(git log -1 --pretty=%s HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '(detached)')"
LOG_DIR="${CERT_LOG_DIR:-$(mktemp -d -t release-certify.XXXXXX)}"
mkdir -p "$LOG_DIR"

enabled() {
  local name="$1"
  if [ -n "$ONLY" ]; then
    contains "$name" ${ONLY_LIST[@]+"${ONLY_LIST[@]}"}
    return $?
  fi
  contains "$name" ${SKIP_LIST[@]+"${SKIP_LIST[@]}"} && return 1
  if contains "$name" "${DEFAULT_OFF[@]}"; then
    [ "$name" = "install" ] && [ "$INSTALL" = "1" ] && return 0
    return 1
  fi
  return 0
}

RANGE=""
resolve_range() {
  local base candidate
  base="${CERT_BASE:-}"
  if [ -z "$base" ]; then
    if candidate="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)" && [ -n "$candidate" ]; then
      base="$candidate"
    else
      for candidate in origin/main main origin/master master; do
        if git rev-parse --verify --quiet "$candidate^{commit}" >/dev/null 2>&1; then base="$candidate"; break; fi
      done
    fi
  fi
  if [ -n "$base" ] && git rev-parse --verify --quiet "$base^{commit}" >/dev/null 2>&1 \
     && git merge-base --is-ancestor "$base" HEAD 2>/dev/null \
     && [ "$(git rev-parse "$base^{commit}")" != "$SHA" ]; then
    RANGE="$base..HEAD"
  fi
}
resolve_range
RANGE_LABEL="${RANGE:-all history reachable from HEAD}"

# ---------------------------------------------------------------- step bodies
step_tree() {
  local dirty
  dirty="$(git status --porcelain --untracked-files=all)"
  if [ -n "$dirty" ]; then
    echo "working tree is not clean; a certification must describe a commit, not local edits:"
    printf '%s\n' "$dirty" | head -n 30
    return 1
  fi
}

step_install() { npm ci; }
step_lint() { npm run lint --silent; }
step_typecheck() { npm run typecheck --silent; }
step_test() { CI=1 npm test --silent; }
step_build() { npm run build --silent; }

step_audit() {
  local out rc
  out="$(npm audit --audit-level=high --omit=dev 2>&1)"; rc=$?
  printf '%s\n' "$out"
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qiE 'ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket hang up|403 Forbidden|audit endpoint returned an error'; then
    echo "audit could not reach the registry: this is a FAILURE, not a pass"
  fi
  return "$rc"
}

step_files() {
  local hits=() f
  while IFS= read -r -d '' f; do
    case "$f" in
      .env.example|*/.env.example) continue ;;
      .env|.env.*|*/.env|*/.env.*) hits+=("$f") ;;
      *.key|*.pem|*.p12|*.pfx) hits+=("$f") ;;
      credentials.json|*/credentials.json) hits+=("$f") ;;
      service-account*.json|*/service-account*.json) hits+=("$f") ;;
      id_rsa|*/id_rsa|id_dsa|*/id_dsa|id_ed25519|*/id_ed25519) hits+=("$f") ;;
    esac
  done < <(git ls-files -z)
  local rc=0
  if [ "${#hits[@]}" -gt 0 ]; then
    echo "prohibited files are tracked at HEAD: ${hits[*]}"
    rc=1
  fi
  local needle missing=()
  for needle in ".env" "node_modules" "dist" "*.key" "*.pem"; do
    if ! grep -Fxq "$needle" .gitignore 2>/dev/null && ! grep -Eq "(^|/)${needle//./\\.}(/|\$)" .gitignore 2>/dev/null; then
      missing+=("$needle")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo ".gitignore is missing required entries: ${missing[*]}"
    rc=1
  fi
  return "$rc"
}

step_secrets() {
  local scanner=".github/pre-deploy-guard/scripts/scan-secrets.sh"
  [ -x "$scanner" ] || { echo "$scanner is missing or not executable"; return 1; }
  echo "range: $RANGE_LABEL"
  if [ -n "$RANGE" ]; then
    git log -p -U0 --no-color --diff-merges=first-parent "$RANGE" | "$scanner"
  else
    git log -p -U0 --no-color --diff-merges=first-parent HEAD | "$scanner"
  fi
}

step_gitleaks() {
  command -v gitleaks >/dev/null 2>&1 || { echo "gitleaks is not installed; the secret scan did not run"; return 1; }
  local want have
  want="$(tr -d '[:space:]' < .gitleaks-version 2>/dev/null)"
  have="$(gitleaks version 2>/dev/null | tr -d '[:space:]')"
  if ! printf '%s' "$want" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo ".gitleaks-version must contain a bare semver (got: '${want:-<empty>}')"
    return 1
  fi
  if [ "$have" != "$want" ]; then
    echo "gitleaks version mismatch: the repository pins $want, this machine has '${have:-unknown}'"
    return 1
  fi
  echo "gitleaks $have, range: $RANGE_LABEL"
  local args=(git --redact --no-banner)
  [ -f .gitleaks.toml ] && args+=(--config .gitleaks.toml)
  [ -n "$RANGE" ] && args+=("--log-opts=$RANGE")
  gitleaks "${args[@]}"
}

step_guard_quick() { bash .github/pre-deploy-guard/scripts/quick-checks.sh; }
step_guard_full() { CI=1 bash .github/pre-deploy-guard/scripts/run-checks.sh; }

step_head() {
  local now
  now="$(git rev-parse HEAD)"
  if [ "$now" != "$SHA" ]; then
    echo "HEAD moved during certification: started at $SHA, now $now"
    return 1
  fi
  step_tree
}

# ----------------------------------------------------------------- execution
RESULT_NAMES=()
RESULT_STATUS=()
RESULT_SECONDS=()
RESULT_NOTE=()
FAILED=0
SKIPPED_REQUIRED=()
TREE_DIRTY=0

record() { RESULT_NAMES+=("$1"); RESULT_STATUS+=("$2"); RESULT_SECONDS+=("$3"); RESULT_NOTE+=("$4"); }

echo "RELEASE CERTIFICATION"
echo "commit  : $SHA"
echo "subject : $SUBJECT"
echo "branch  : $BRANCH"
echo "range   : $RANGE_LABEL"
echo "node    : $(node --version 2>/dev/null || echo 'not found')"
echo "started : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "logs    : $LOG_DIR"
echo

for name in "${ALL_STEPS[@]}"; do
  if ! enabled "$name"; then
    record "$name" "SKIP" "-" "not run"
    contains "$name" "${DEFAULT_OFF[@]}" || SKIPPED_REQUIRED+=("$name")
    continue
  fi
  if [ "$DRY_RUN" = "1" ]; then
    record "$name" "PLAN" "-" "dry run"
    continue
  fi
  if [ "$TREE_DIRTY" = "1" ] && [ "$name" != "head" ]; then
    record "$name" "SKIP" "-" "working tree is dirty"
    continue
  fi
  fn="step_${name//-/_}"
  log="$LOG_DIR/$name.log"
  started=$SECONDS
  echo "[run ] $name"
  "$fn" >"$log" 2>&1
  rc=$?
  elapsed=$((SECONDS - started))
  if [ "$rc" -eq 0 ]; then
    record "$name" "PASS" "$elapsed" "$log"
    echo "[pass] $name (${elapsed}s)"
  else
    record "$name" "FAIL" "$elapsed" "$log"
    FAILED=$((FAILED + 1))
    echo "[FAIL] $name (${elapsed}s, exit $rc)"
    sed 's/^/         /' "$log" | tail -n 20
    [ "$name" = "tree" ] && TREE_DIRTY=1
  fi
done

echo
printf '%-12s %-6s %8s  %s\n' STEP RESULT SECONDS DETAIL
for i in "${!RESULT_NAMES[@]}"; do
  printf '%-12s %-6s %8s  %s\n' "${RESULT_NAMES[$i]}" "${RESULT_STATUS[$i]}" "${RESULT_SECONDS[$i]}" "${RESULT_NOTE[$i]}"
done
echo

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY RUN: nothing was executed. Commit that would be certified: $SHA"
  exit 0
fi

JSON="$LOG_DIR/release-certification-$SHA.json"
{
  printf '{\n  "commit": "%s",\n  "range": "%s",\n  "steps": [\n' "$SHA" "$RANGE_LABEL"
  for i in "${!RESULT_NAMES[@]}"; do
    sep=","; [ "$i" -eq $((${#RESULT_NAMES[@]} - 1)) ] && sep=""
    printf '    {"step": "%s", "result": "%s", "seconds": "%s"}%s\n' "${RESULT_NAMES[$i]}" "${RESULT_STATUS[$i]}" "${RESULT_SECONDS[$i]}" "$sep"
  done
  printf '  ]\n}\n'
} >"$JSON"
echo "summary : $JSON"

if [ "$FAILED" -gt 0 ]; then
  echo "RESULT  : NOT CERTIFIED - $FAILED step(s) failed for commit $SHA"
  exit 1
fi
if [ "${#SKIPPED_REQUIRED[@]}" -gt 0 ]; then
  echo "RESULT  : NOT CERTIFIED - partial run, skipped: ${SKIPPED_REQUIRED[*]} (commit $SHA)"
  exit 3
fi
echo "RESULT  : CERTIFIED - every step passed for commit $SHA"
