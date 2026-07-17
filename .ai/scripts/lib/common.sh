#!/usr/bin/env bash
# Shared helpers for sync-template.sh. Pure bash + awk/sed — no yq dependency.
# The YAML parsing here is deliberately minimal and only understands the specific,
# fixed shape of templates/*/template.yaml. It is not a general YAML parser.

set -euo pipefail

# ---- output helpers ---------------------------------------------------------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

info()  { printf '%s\n' "${C_BLUE}•${C_RESET} $*"; }
ok()    { printf '%s\n' "${C_GREEN}✓${C_RESET} $*"; }
warn()  { printf '%s\n' "${C_YELLOW}!${C_RESET} $*" >&2; }
err()   { printf '%s\n' "${C_RED}✗${C_RESET} $*" >&2; }
die()   { err "$*"; exit 1; }

# ---- checksums (portable macOS + linux) -------------------------------------
sha256_of() {
  # sha256 of a file, hex only
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "no sha256 tool found (need sha256sum or shasum)"
  fi
}

# ---- minimal YAML readers (fixed schema only) -------------------------------

# yaml_scalar <file> <key> — value of a top-level `key: value` (unquoted, trimmed).
yaml_scalar() {
  awk -v k="$2" '
    $0 ~ "^"k":" {
      sub("^"k":[ \t]*", ""); sub(/[ \t]+#.*$/, ""); sub(/[ \t]+$/, "")
      gsub(/^"|"$/, ""); print; exit
    }' "$1"
}

# yaml_list <file> <key> — items under a top-level `key:` written as `  - item`.
# Stops at the next line that starts a new top-level key (no leading space).
yaml_list() {
  awk -v k="$2" '
    $0 ~ "^"k":" { inblk=1; next }
    inblk && /^[^[:space:]]/ { inblk=0 }
    inblk && /^[[:space:]]*-[[:space:]]/ {
      sub(/^[[:space:]]*-[[:space:]]*/, ""); sub(/[ \t]+#.*$/, "")
      sub(/[ \t]+$/, ""); gsub(/^"|"$/, ""); print
    }
  ' "$1"
}

# yaml_sublist <file> <parent> <child> — items under `parent:` then nested `child:`.
# e.g. parent=shared child=standards.
yaml_sublist() {
  awk -v p="$2" -v c="$3" '
    $0 ~ "^"p":" { inp=1; next }
    inp && /^[^[:space:]]/ { inp=0; inc=0 }
    inp && $0 ~ "^[[:space:]]+"c":" { inc=1; next }
    inc && /^[[:space:]]{0,2}[^[:space:]-]/ { inc=0 }
    inc && /^[[:space:]]*-[[:space:]]/ {
      sub(/^[[:space:]]*-[[:space:]]*/, ""); sub(/[ \t]+#.*$/, "")
      sub(/[ \t]+$/, ""); gsub(/^"|"$/, ""); print
    }
  ' "$1"
}

# ---- template resolution ----------------------------------------------------

# resolve_shipped_file <lib_root> <template_id> <rel_path>
# Prints the absolute source path for a file listed under a template's `files:`.
# Looks in the template's own files/ first, then falls back to any other
# template's files/ (this lets fullstack reuse the stack docs/rules by path).
resolve_shipped_file() {
  local lib="$1" tid="$2" rel="$3" cand
  cand="$lib/templates/$tid/files/$rel"
  if [ -f "$cand" ]; then printf '%s\n' "$cand"; return 0; fi
  local f
  for f in "$lib"/templates/*/files/"$rel"; do
    [ -f "$f" ] && { printf '%s\n' "$f"; return 0; }
  done
  return 1
}

# extends_chain <lib_root> <template_id>
# Prints template ids from base → leaf (so leaf overrides base).
extends_chain() {
  local lib="$1" tid="$2"
  local cur="$tid" guard=0 chain=""
  while [ -n "$cur" ] && [ "$cur" != "null" ]; do
    [ -f "$lib/templates/$cur/template.yaml" ] || die "unknown template: $cur"
    chain="$cur"$'\n'"$chain"   # prepend: base ends up first
    cur="$(yaml_scalar "$lib/templates/$cur/template.yaml" extends)"
    guard=$((guard+1)); [ "$guard" -gt 20 ] && die "extends cycle detected"
  done
  printf '%s' "$chain" | grep -v '^$' || true
}
