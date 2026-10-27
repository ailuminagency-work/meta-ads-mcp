#!/usr/bin/env bash
# scan-secrets.sh — Custom regex scanner for project-specific secrets.
# Reads input from stdin (a unified diff or file content). Falls back to
# `git diff --cached -U0` whenever stdin yields no bytes.
#
# Exits 0 if nothing was found, 1 if at least one pattern matched.
# Prints matches in a `<file>:<line>: <pattern-name>` style for easy parsing.

set -uo pipefail

# Patterns: name|regex
# Order matters only for reporting — every pattern is checked.
PATTERNS=(
  'meta-app-secret|(^|[^A-Za-z0-9_])META_APP_SECRET[[:space:]]*=[[:space:]]*["'\''"]?[A-Za-z0-9]{16,}'
  'meta-access-token|EAA[A-Za-z0-9]{20,}'
  'apify-api-token|apify_api_[A-Za-z0-9]{20,}'
  'oauth-secret|(^|[^A-Za-z0-9_])OAUTH_SECRET[[:space:]]*=[[:space:]]*["'\''"]?[A-Za-z0-9+/=]{32,}'
  'oauth-approval-pin|(^|[^A-Za-z0-9_])OAUTH_APPROVAL_PIN[[:space:]]*=[[:space:]]*["'\''"]?[A-Za-z0-9]{6,}'
  'token-encryption-key|(^|[^A-Za-z0-9_])TOKEN_ENCRYPTION_KEY[[:space:]]*=[[:space:]]*["'\''"]?[A-Fa-f0-9]{64}'
  'session-cookie-secret|(^|[^A-Za-z0-9_])SESSION_COOKIE_SECRET[[:space:]]*=[[:space:]]*["'\''"]?[A-Za-z0-9+/=]{32,}'
  'mcp-api-key|(^|[^A-Za-z0-9_])MCP_API_KEY[[:space:]]*=[[:space:]]*["'\''"]?[A-Za-z0-9]{20,}'
  'meta-tokens-json|(^|[^A-Za-z0-9_])META_TOKENS[[:space:]]*=[[:space:]]*["'\''"]?\{[^}]*EAA'
  'google-oauth-token|ya29\.[0-9A-Za-z_-]{30,}'
  'google-api-key|AIza[0-9A-Za-z_-]{35}'
  'gemini-auth-key|AQ\.[A-Za-z0-9_-]{20,}'
  'gemini-api-key|(^|[^A-Za-z0-9_])GEMINI_API_KEY[[:space:]]*=[[:space:]]*["'\''"]?[A-Za-z0-9_.-]{20,}'
  'gcp-service-account-key|"private_key":[[:space:]]*"-----BEGIN'
  'private-key-block|-----BEGIN[[:space:]]*(RSA|EC|DSA|OPENSSH|PGP)?[[:space:]]*PRIVATE[[:space:]]*KEY-----'
  'github-token|gh[pousr]_[A-Za-z0-9]{36,}'
  'aws-access-key|AKIA[0-9A-Z]{16}'
)

# Allowlist: a finding is dropped when the MATCHED TEXT contains one of these
# substrings (case-sensitive), so a real token never becomes invisible because
# the word "fixture" or "placeholder" appears somewhere else on its line.
# Mainly to suppress obvious examples / placeholders / stripped redactions.
ALLOWLIST=(
  'EAAabcdefghij'                 # canonical example placeholder
  'EAA[A-Za-z0-9]{20'              # the regex itself if dumped to a file
  'YOUR_'
  'EXAMPLE'
  'placeholder'
  'PLACEHOLDER'
  '<your-'
  'fixture'
)

# The one line-level exemption, the same marker gitleaks honours: a comment that
# ends the line and says exactly gitleaks:allow (after #, //, --, /* or <!--).
# The marker anywhere else on the line, or followed by other words, suppresses nothing.
LINE_MARKER='(#|//|--|/\*|<!--)[[:space:]]*gitleaks:allow[[:space:]]*(\*/|-->)?[[:space:]]*$'

# Source the diff: piped stdin when there is one, else the staged diff.
WORKDIR="$(mktemp -d -t scan-secrets.XXXXXX)" || {
  echo "scan-secrets: cannot create a working directory; refusing to report clean" >&2
  exit 1
}
trap 'rm -rf "$WORKDIR"' EXIT
INPUT="$WORKDIR/input"
: > "$INPUT"

if [ -p /dev/stdin ] || { [ ! -t 0 ] && [ -f /dev/stdin ]; }; then
  cat > "$INPUT"
fi

# Testing `-t 0` alone was not enough: under an agent, a PreToolUse hook or a CI
# runner, stdin is a closed pipe rather than a TTY, so the read returned nothing
# and an unscanned diff reported clean. Fall back to the index whenever stdin
# produced no bytes, regardless of what kind of handle it was.
if [ ! -s "$INPUT" ] && git rev-parse --git-dir >/dev/null 2>&1; then
  git diff --cached -U0 > "$INPUT" 2>/dev/null || true
fi

if [ ! -s "$INPUT" ]; then
  # Reporting clean while the index holds staged changes is the exact false
  # negative this scanner exists to prevent, so fail closed instead.
  if git rev-parse --git-dir >/dev/null 2>&1 && ! git diff --cached --quiet 2>/dev/null; then
    echo "scan-secrets: no scannable input though the index has staged changes; refusing to report clean" >&2
    exit 1
  fi
  exit 0
fi

# Parse unified diff to track current file and line number per hunk.
# We only check lines that start with '+' (additions) but not the '+++' header.
HITS=0
MAP="$WORKDIR/map"

# The file name comes from git's own header lines and is kept exactly as written,
# spaces included, because the path skips below compare whole names.
#
# Inside a hunk the counts in its "@@" line say how many lines belong to it, so a
# content line that merely looks like a header cannot change the current file:
# the added line "++ b/package-lock.json" is shown in the diff as
# "+++ b/package-lock.json" and used to move every later line of the hunk into
# a skipped file.
awk '
  function git_header_path(rest,    total, half, tail, offset, last, pos, parts, n, name) {
    # "a/NAME b/NAME": git repeats the name on both sides unless the file was renamed.
    total = length(rest)
    if (total >= 7 && (total - 5) % 2 == 0) {
      half = (total - 5) / 2
      if (substr(rest, 1, 2) == "a/" && substr(rest, 3 + half, 3) == " b/" && substr(rest, 3, half) == substr(rest, 6 + half, half)) {
        return substr(rest, 3, half)
      }
    }
    # Renamed or quoted: take what follows the last " b/", else the last word.
    tail = rest; offset = 0; last = 0
    while ((pos = index(tail, " b/")) > 0) {
      last = offset + pos
      offset += pos
      tail = substr(tail, pos + 1)
    }
    if (last > 0) return substr(rest, last + 3)
    n = split(rest, parts, " ")
    name = parts[n]
    sub(/^b\//, "", name)
    return name
  }
  in_hunk && (old_left > 0 || new_left > 0) {
    c = substr($0, 1, 1)
    if (c == "+") { new_left--; print file "\t" line "\t" substr($0, 2); line++; next }
    if (c == "-") { old_left--; next }
    if (c == " " || c == "") { old_left--; new_left--; line++; next }
    if (c == "\\") { next }
    in_hunk = 0
  }
  /^diff --git / {
    in_hunk = 0; old_left = 0; new_left = 0
    file = git_header_path(substr($0, 12))
    next
  }
  /^\+\+\+ / {
    # +++ b/<file>, with a trailing TAB (and a timestamp from plain diff) after names git quotes by hand.
    f = substr($0, 5)
    sub(/\t.*$/, "", f)
    sub(/^b\//, "", f)
    if (f != "/dev/null") file = f
    next
  }
  /^@@ / {
    # @@ -a[,b] +c[,d] @@ ; a count that is left out means 1
    old_left = 1; new_left = 1
    if (match($0, /-[0-9]+(,[0-9]+)?/)) {
      spec = substr($0, RSTART + 1, RLENGTH - 1)
      if (index(spec, ",")) old_left = substr(spec, index(spec, ",") + 1) + 0
    }
    if (match($0, /\+[0-9]+(,[0-9]+)?/)) {
      spec = substr($0, RSTART + 1, RLENGTH - 1)
      line = spec + 0
      if (index(spec, ",")) new_left = substr(spec, index(spec, ",") + 1) + 0
    }
    in_hunk = 1
    next
  }
  /^---/ { next }
  /^\+\+\+/ { next }
  # Added lines past the counts of a hunk (a diff whose counts are wrong) are still scanned.
  in_hunk && /^\+/ {
    body = substr($0, 2)
    print file "\t" line "\t" body
    line++
    next
  }
  in_hunk && /^-/ { next }
  in_hunk && /^ / { line++; next }
  { in_hunk = 0 }
' "$INPUT" > "$MAP"

# Absence of diff structure means plain file content, which the docstring
# accepts; scanning nothing and reporting clean is the failure this guard
# exists to prevent. Both a header and a hunk marker are required, so a plain
# file that merely contains a diff-looking line still gets scanned in full.
# Judging by the parse being empty instead would misread a deletion-only diff
# as plain text and flag the very removal of a secret.
if ! { grep -qE '^(diff --git |--- )' "$INPUT" && grep -qE '^@@ ' "$INPUT"; }; then
  awk '{ print "(stdin)\t" NR "\t" $0 }' "$INPUT" > "$MAP"
fi

# Most lines match nothing. One pass with every pattern joined drops them before
# the per-pattern checks below, which cost tens of milliseconds a line. It only
# ever keeps more than the checks would: the text is searched byte for byte, and
# in a map line the added text follows a TAB, which satisfies the same
# "start or non-word character" prefix the patterns ask for.
CANDIDATES="$WORKDIR/candidates"
COMBINED=""
for entry in "${PATTERNS[@]}"; do
  COMBINED="${COMBINED:+$COMBINED|}(${entry#*|})"
done
LC_ALL=C grep -a -E -- "$COMBINED" "$MAP" > "$CANDIDATES"
PREFILTER_STATUS=$?
if [ "$PREFILTER_STATUS" -gt 1 ]; then
  echo "scan-secrets: the prefilter failed (status $PREFILTER_STATUS); refusing to report clean" >&2
  exit 1
fi

while IFS=$'\t' read -r FILE HIT_LINE BODY; do
  # Path skips are repository-root files only. A directory or file name that
  # merely looks like one of them (docs/package-lock.json, deploy/.env.example,
  # src/x/scan-secrets.sh, anything ending .lock) is scanned like any other.
  case "$FILE" in
    package-lock.json|yarn.lock|pnpm-lock.yaml) continue ;;
    # Self-references: the gitleaks config and this script declare the
    # very regex shapes we look for as PATTERNS. Skip them so a doc-only
    # change to either doesn't trigger a guard against itself.
    .gitleaks.toml|.github/pre-deploy-guard/scripts/scan-secrets.sh) continue ;;
  esac

  printf '%s' "$BODY" | grep -E -q -- "$LINE_MARKER" && continue

  for entry in "${PATTERNS[@]}"; do
    NAME="${entry%%|*}"
    RE="${entry#*|}"
    MATCHES="$(printf '%s' "$BODY" | grep -E -o -- "$RE" || true)"
    [ -n "$MATCHES" ] || continue
    FOUND=0
    while IFS= read -r MATCHED; do
      allowed=0
      for needle in "${ALLOWLIST[@]}"; do
        case "$MATCHED" in *"$needle"*) allowed=1; break ;; esac
      done
      if [ "$allowed" = "0" ]; then FOUND=1; break; fi
    done <<< "$MATCHES"
    if [ "$FOUND" = "1" ]; then
      printf '%s:%s: %s\n' "$FILE" "$HIT_LINE" "$NAME"
      HITS=$((HITS+1))
    fi
  done
done < "$CANDIDATES"

if [ "$HITS" -gt 0 ]; then
  echo ""
  echo "scan-secrets: $HITS finding(s) in staged diff"
  exit 1
fi
exit 0
