#!/usr/bin/env bash
#
# sync-template.sh — scaffold and update projects from ai-dev-template-library.
#
# Usage:
#   sync-template.sh init   <template-id> <project-dir>   Scaffold a new project.
#   sync-template.sh check  <project-dir>                 Dry run: show what update would do.
#   sync-template.sh update <project-dir>                 Apply updates (non-destructive).
#   sync-template.sh list                                 List available templates.
#
# Update model (copy + version stamp):
#   Every managed file is recorded in <project>/.ai/.template-manifest.yaml with the
#   library version and the sha256 it had when installed. On `update`, each file is
#   classified with a 3-way comparison (installed sha vs current sha vs new library sha):
#     - up to date        → skip
#     - upstream changed   → update, keep going
#     - locally modified   → never clobbered; you're shown a diff and asked
#   Scaffold files (project-context, architecture) are written once and never updated.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

LIBRARY_VERSION="$(cat "$LIB_ROOT/VERSION")"
MANIFEST_REL=".ai/.template-manifest.yaml"

# ---- plan building ----------------------------------------------------------
# Emits lines "<dest>\t<source>\t<scaffold:true|false>" to stdout, leaf-wins deduped.
build_plan() {
  local tid="$1" tmpl chain rel src cat item scaffold
  local plan_raw; plan_raw="$(mktemp)"

  chain="$(extends_chain "$LIB_ROOT" "$tid")"
  while IFS= read -r tmpl; do
    [ -n "$tmpl" ] || continue
    local yaml="$LIB_ROOT/templates/$tmpl/template.yaml"

    # scaffold-only set for this template
    local scaffold_set; scaffold_set="$(yaml_list "$yaml" scaffold_only || true)"

    # 1) files shipped by the template
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      if ! src="$(resolve_shipped_file "$LIB_ROOT" "$tmpl" "$rel")"; then
        die "template '$tmpl' lists missing file: $rel"
      fi
      scaffold=false
      printf '%s\n' "$scaffold_set" | grep -qxF "$rel" && scaffold=true
      printf '%s\t%s\t%s\n' "$rel" "$src" "$scaffold" >>"$plan_raw"
    done < <(yaml_list "$yaml" files || true)

    # 2) shared content -> .ai/<category>/<item>
    for cat in standards roles workflows; do
      while IFS= read -r item; do
        [ -n "$item" ] || continue
        src="$LIB_ROOT/$cat/$item"
        [ -f "$src" ] || die "shared $cat missing in library: $item"
        printf '%s\t%s\t%s\n' ".ai/$cat/$item" "$src" "false" >>"$plan_raw"
      done < <(yaml_sublist "$yaml" shared "$cat" || true)
    done
  done <<< "$chain"

  # leaf-wins dedup by dest (keep last occurrence)
  awk -F'\t' '{ line[$1]=$0; order[$1]=NR } END { for (k in line) print order[k]"\t"line[k] }' \
    "$plan_raw" | sort -n | cut -f2-
  rm -f "$plan_raw"
}

# recorded sha for a dest path from a manifest file ("" if absent)
manifest_sha()     { awk -F'\t' -v d="$2" '$1=="FILE" && $2==d {print $4}' "$1" 2>/dev/null; }
manifest_scaffold(){ awk -F'\t' -v d="$2" '$1=="FILE" && $2==d {print $5}' "$1" 2>/dev/null; }
manifest_template(){ yaml_scalar "$1" template; }

copy_file() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
}

# ---- commands ---------------------------------------------------------------

cmd_list() {
  info "Available templates:"
  local d id name
  for d in "$LIB_ROOT"/templates/*/; do
    [ -f "$d/template.yaml" ] || continue
    id="$(yaml_scalar "$d/template.yaml" id)"
    name="$(yaml_scalar "$d/template.yaml" name)"
    printf '  %s%-28s%s %s\n' "$C_BOLD" "$id" "$C_RESET" "$name"
  done
}

cmd_init() {
  local tid="$1" dest="$2"
  [ -f "$LIB_ROOT/templates/$tid/template.yaml" ] || die "unknown template: $tid (try: list)"
  mkdir -p "$dest"
  local manifest="$dest/$MANIFEST_REL"
  [ -f "$manifest" ] && die "project already initialized ($MANIFEST_REL exists). Use: update"

  local today; today="$(date +%F)"
  mkdir -p "$(dirname "$manifest")"
  {
    printf 'template: %s\n' "$tid"
    printf 'library_version: %s\n' "$LIBRARY_VERSION"
    printf 'generated_at: %s\n' "$today"
    printf '# managed files — do not edit by hand\n'
    printf '# FILE\\t<dest>\\t<version>\\t<sha256>\\t<scaffold>\n'
  } >"$manifest"

  local dest_rel src scaffold count=0
  while IFS=$'\t' read -r dest_rel src scaffold; do
    [ -n "$dest_rel" ] || continue
    copy_file "$src" "$dest/$dest_rel"
    printf 'FILE\t%s\t%s\t%s\t%s\n' \
      "$dest_rel" "$LIBRARY_VERSION" "$(sha256_of "$dest/$dest_rel")" "$scaffold" >>"$manifest"
    count=$((count+1))
  done < <(build_plan "$tid")

  ok "Scaffolded '$tid' into $dest ($count files, library v$LIBRARY_VERSION)."
  info "Next: fill in ${C_BOLD}.ai/project-context.md${C_RESET} and ${C_BOLD}.ai/architecture.md${C_RESET}."
}

# shared engine for check/update. $2=apply(true|false)
run_sync() {
  local dest="$1" apply="$2"
  local manifest="$dest/$MANIFEST_REL"
  [ -f "$manifest" ] || die "not a template project (no $MANIFEST_REL). Use: init"

  local tid; tid="$(manifest_template "$manifest")"
  [ -n "$tid" ] || die "manifest missing 'template:' field"
  info "Project: $dest"
  info "Template: $tid   installed: v$(yaml_scalar "$manifest" library_version)   library: v$LIBRARY_VERSION"
  printf '\n'

  local new_manifest; new_manifest="$(mktemp)"
  {
    printf 'template: %s\n' "$tid"
    printf 'library_version: %s\n' "$LIBRARY_VERSION"
    printf 'generated_at: %s\n' "$(date +%F)"
    printf '# managed files — do not edit by hand\n'
    printf '# FILE\\t<dest>\\t<version>\\t<sha256>\\t<scaffold>\n'
  } >"$new_manifest"

  local dest_rel src scaffold
  local n_new=0 n_upd=0 n_same=0 n_scaffold=0 n_conflict=0 n_local=0

  while IFS=$'\t' read -r dest_rel src scaffold; do
    [ -n "$dest_rel" ] || continue
    local path="$dest/$dest_rel"
    local rec_sha; rec_sha="$(manifest_sha "$manifest" "$dest_rel")"
    local new_sha; new_sha="$(sha256_of "$src")"

    # scaffold files: install once, then leave alone forever
    if [ "$scaffold" = "true" ]; then
      if [ ! -f "$path" ]; then
        [ "$apply" = "true" ] && copy_file "$src" "$path"
        printf '%s\n' "  ${C_GREEN}new${C_RESET}      $dest_rel ${C_DIM}(scaffold)${C_RESET}"
        n_new=$((n_new+1))
        rec_sha="$( [ "$apply" = true ] && sha256_of "$path" || echo "$new_sha" )"
      else
        printf '%s\n' "  ${C_DIM}scaffold${C_RESET} $dest_rel ${C_DIM}(project-owned, untouched)${C_RESET}"
        n_scaffold=$((n_scaffold+1))
        rec_sha="$(sha256_of "$path")"
      fi
      printf 'FILE\t%s\t%s\t%s\t%s\n' "$dest_rel" "$LIBRARY_VERSION" "$rec_sha" "true" >>"$new_manifest"
      continue
    fi

    if [ ! -f "$path" ]; then
      [ "$apply" = "true" ] && copy_file "$src" "$path"
      printf '%s\n' "  ${C_GREEN}new${C_RESET}      $dest_rel"
      n_new=$((n_new+1))
      printf 'FILE\t%s\t%s\t%s\tfalse\n' "$dest_rel" "$LIBRARY_VERSION" "$new_sha" >>"$new_manifest"
      continue
    fi

    local cur_sha; cur_sha="$(sha256_of "$path")"

    if [ "$cur_sha" = "$new_sha" ]; then
      printf '%s\n' "  ${C_DIM}ok${C_RESET}       $dest_rel"
      n_same=$((n_same+1))
      printf 'FILE\t%s\t%s\t%s\tfalse\n' "$dest_rel" "$LIBRARY_VERSION" "$cur_sha" >>"$new_manifest"
    elif [ "$cur_sha" = "$rec_sha" ]; then
      # unmodified locally, upstream changed → safe update
      [ "$apply" = "true" ] && copy_file "$src" "$path"
      printf '%s\n' "  ${C_BLUE}update${C_RESET}   $dest_rel"
      n_upd=$((n_upd+1))
      printf 'FILE\t%s\t%s\t%s\tfalse\n' "$dest_rel" "$LIBRARY_VERSION" "$new_sha" >>"$new_manifest"
    elif [ "$new_sha" = "$rec_sha" ]; then
      # locally modified, upstream unchanged → keep local, no conflict
      printf '%s\n' "  ${C_YELLOW}local${C_RESET}    $dest_rel ${C_DIM}(local edits, upstream unchanged)${C_RESET}"
      n_local=$((n_local+1))
      printf 'FILE\t%s\t%s\t%s\tfalse\n' "$dest_rel" "$(yaml_scalar "$manifest" library_version)" "$cur_sha" "" >>"$new_manifest"
    else
      # both changed → conflict
      printf '%s\n' "  ${C_RED}conflict${C_RESET} $dest_rel ${C_DIM}(local edits AND upstream changed)${C_RESET}"
      n_conflict=$((n_conflict+1))
      local keep_sha="$cur_sha" keep_ver
      keep_ver="$(yaml_scalar "$manifest" library_version)"
      if [ "$apply" = "true" ]; then
        printf '\n%s\n' "${C_DIM}--- diff: your file (<) vs library v$LIBRARY_VERSION (>) ---${C_RESET}"
        diff "$path" "$src" || true
        printf '\n'
        local ans
        printf '%s' "  Resolve $dest_rel — [k]eep local / [t]ake library / [s]kip? [k] "
        read -r ans </dev/tty || ans="k"
        case "$ans" in
          t|T) copy_file "$src" "$path"; keep_sha="$new_sha"; keep_ver="$LIBRARY_VERSION"
               ok "took library version" ;;
          s|S) warn "skipped (manifest not advanced for this file)" ;;
          *)   ok "kept local version" ;;
        esac
      fi
      printf 'FILE\t%s\t%s\t%s\tfalse\n' "$dest_rel" "$keep_ver" "$keep_sha" >>"$new_manifest"
    fi
  done < <(build_plan "$tid")

  printf '\n'
  info "Summary: ${C_GREEN}$n_new new${C_RESET}, ${C_BLUE}$n_upd updated${C_RESET}, $n_same up-to-date, ${C_YELLOW}$n_local local${C_RESET}, ${C_RED}$n_conflict conflict${C_RESET}, $n_scaffold scaffold"

  if [ "$apply" = "true" ]; then
    mv "$new_manifest" "$manifest"
    ok "Manifest updated → library v$LIBRARY_VERSION"
  else
    rm -f "$new_manifest"
    info "Dry run — nothing written. Run ${C_BOLD}update${C_RESET} to apply."
  fi
}

usage() {
  cat <<EOF
${C_BOLD}sync-template.sh${C_RESET} — scaffold & update projects from ai-dev-template-library (v$LIBRARY_VERSION)

  ${C_BOLD}init${C_RESET}   <template-id> <project-dir>   Scaffold a new project
  ${C_BOLD}check${C_RESET}  <project-dir>                 Dry run: show what update would do
  ${C_BOLD}update${C_RESET} <project-dir>                 Apply updates (non-destructive)
  ${C_BOLD}list${C_RESET}                                 List available templates

Examples:
  scripts/sync-template.sh list
  scripts/sync-template.sh init fullstack-nextjs-fastapi ../my-app
  scripts/sync-template.sh check  ../my-app
  scripts/sync-template.sh update ../my-app
EOF
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    init)   [ $# -eq 2 ] || { usage; exit 1; }; cmd_init "$1" "$2" ;;
    check)  [ $# -eq 1 ] || { usage; exit 1; }; run_sync "$1" false ;;
    update) [ $# -eq 1 ] || { usage; exit 1; }; run_sync "$1" true ;;
    list)   cmd_list ;;
    ""|-h|--help|help) usage ;;
    *) err "unknown command: $cmd"; usage; exit 1 ;;
  esac
}

main "$@"
