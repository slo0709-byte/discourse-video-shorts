#!/usr/bin/env bash
# Runs an externally configured visual runner; baseline updates are intentionally not supported here.
set -euo pipefail

usage() {
  printf '%s\n' "usage: $0 --matrix PATH --evidence-dir DIR --max-diff-ratio 0.005 [--self-test]"
}

self_test() {
  local status=0
  "$0" --matrix /definitely/missing --evidence-dir /definitely/missing --max-diff-ratio 0.005 >/dev/null 2>&1 && status=1
  [[ "$status" -eq 0 ]] || { printf '%s\n' "self-test failed: missing visual inputs did not fail" >&2; return 1; }
  printf '%s\n' "self-test passed: missing visual inputs fail closed"
}

matrix=""
evidence_dir=""
max_diff=""
self_test_only=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --matrix) matrix="${2:-}"; shift 2 ;;
    --evidence-dir) evidence_dir="${2:-}"; shift 2 ;;
    --max-diff-ratio) max_diff="${2:-}"; shift 2 ;;
    --self-test) self_test_only=true; shift ;;
    --help|-h) usage; exit 0 ;;
    --update-baseline) printf '%s\n' "baseline updates are prohibited by this wrapper" >&2; exit 2 ;;
    *) usage >&2; exit 2 ;;
  esac
done

if "$self_test_only"; then
  [[ -z "$matrix$evidence_dir$max_diff" ]] || { printf '%s\n' "--self-test cannot be combined with run options" >&2; exit 2; }
  self_test
  exit 0
fi

[[ -n "$matrix" && -f "$matrix" ]] || { printf '%s\n' "missing matrix file" >&2; exit 2; }
[[ -n "$evidence_dir" && -d "$evidence_dir" ]] || { printf '%s\n' "missing evidence directory" >&2; exit 2; }
[[ "$max_diff" == "0.005" ]] || { printf '%s\n' "--max-diff-ratio must be exactly 0.005" >&2; exit 2; }
[[ -n "${QA_VISUAL_COMMAND:-}" ]] || { printf '%s\n' "QA_VISUAL_COMMAND must name the real screenshot/diff runner; refusing to fabricate visual evidence" >&2; exit 2; }
runner="${QA_VISUAL_COMMAND%% *}"
command -v "$runner" >/dev/null 2>&1 || { printf '%s\n' "configured runner is unavailable: $runner" >&2; exit 2; }

# The runner must capture actual browser/device screenshots and write them under evidence_dir.
# shellcheck disable=SC2086
$QA_VISUAL_COMMAND --matrix "$matrix" --evidence-dir "$evidence_dir" --max-diff-ratio "$max_diff"
"$(dirname "$0")/validate_evidence.rb" "$evidence_dir"
"$(dirname "$0")/verify_observability_privacy.rb" "$evidence_dir"
