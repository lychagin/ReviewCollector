#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "Usage: $0 <target-dir> [claude-dir]"
  echo ""
  echo "  target-dir   Root of the target project (required)"
  echo "  claude-dir   Path to .claude directory (default: <target-dir>/.claude)"
  exit 1
}

if [[ $# -lt 1 ]]; then
  echo "Error: target-dir is required"
  usage
fi

TARGET_DIR="$(realpath "$1")"
CLAUDE_DIR="${2:-$TARGET_DIR/.claude}"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Error: target directory does not exist: $TARGET_DIR"
  exit 1
fi

echo "Installing review-collector into: $TARGET_DIR"
echo "Claude skills directory: $CLAUDE_DIR"
