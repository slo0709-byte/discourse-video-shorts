#!/usr/bin/env bash
# Runs an externally configured real-browser/device runner and fails closed on absent evidence.
set -euo pipefail

usage() {
  printf '%s\n' "usage: $0 --matrix PATH --evidence-dir DIR --require desktop-chrome,desktop-edge,iphone-safari,android-chrome [--repeat-sync 30] [--comments-descendants 201] [--self-test]"
}

self_test() {
  local status=0
  "$0" --matrix /definitely/missing --evidence-dir /definitely/missing --require desktop-chrome >/dev/null 2>&1 && status=1
  [[ "$status" -eq 0 ]] || { printf '%s\n' "self-test failed: missing artifacts did not fail" >&2; return 1; }
  printf '%s\n' "self-test passed: missing matrix/evidence fails closed"
}

matrix=""
evidence_dir=""
required=""
repeat_sync=30
descendants=201
self_test_only=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --matrix) matrix="${2:-}"; shift 2 ;;
    --evidence-dir) evidence_dir="${2:-}"; shift 2 ;;
    --require) required="${2:-}"; shift 2 ;;
    --repeat-sync) repeat_sync="${2:-}"; shift 2 ;;
    --comments-descendants) descendants="${2:-}"; shift 2 ;;
    --self-test) self_test_only=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

if "$self_test_only"; then
  [[ -z "$matrix$evidence_dir$required" ]] || { printf '%s\n' "--self-test cannot be combined with run options" >&2; exit 2; }
  self_test
  exit 0
fi

[[ -n "$matrix" && -f "$matrix" ]] || { printf '%s\n' "missing matrix file" >&2; exit 2; }
[[ -n "$evidence_dir" && -d "$evidence_dir" ]] || { printf '%s\n' "missing evidence directory" >&2; exit 2; }
[[ "$required" == "desktop-chrome,desktop-edge,iphone-safari,android-chrome" ]] || { printf '%s\n' "--require must name all four target browsers in canonical order" >&2; exit 2; }
[[ "$repeat_sync" =~ ^[0-9]+$ && "$repeat_sync" -ge 30 ]] || { printf '%s\n' "--repeat-sync must be at least 30" >&2; exit 2; }
[[ "$descendants" =~ ^[0-9]+$ && "$descendants" -ge 201 ]] || { printf '%s\n' "--comments-descendants must be at least 201" >&2; exit 2; }
[[ -n "${QA_E2E_COMMAND:-}" ]] || { printf '%s\n' "QA_E2E_COMMAND must name the real browser/device runner; refusing to fabricate evidence" >&2; exit 2; }
runner="${QA_E2E_COMMAND%% *}"
command -v "$runner" >/dev/null 2>&1 || { printf '%s\n' "configured runner is unavailable: $runner" >&2; exit 2; }

# The runner owns acquisition. This wrapper only passes requirements and validates generated evidence.
# shellcheck disable=SC2086
$QA_E2E_COMMAND --matrix "$matrix" --evidence-dir "$evidence_dir" --require "$required" --repeat-sync "$repeat_sync" --comments-descendants "$descendants"
"$(dirname "$0")/validate_evidence.rb" "$evidence_dir"
"$(dirname "$0")/verify_observability_privacy.rb" "$evidence_dir"
