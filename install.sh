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

TARGET_DIR="$(realpath -m "$1")"
CLAUDE_DIR="${2:-$TARGET_DIR/.claude}"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Error: target directory does not exist: $TARGET_DIR"
  exit 1
fi

echo "Installing review-collector into: $TARGET_DIR"
echo "Claude skills directory: $CLAUDE_DIR"

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "Warning: node not found. review-collector requires Node.js 18+."
  echo "Install from https://nodejs.org before using the tool."
fi

# Pre-flight: verify source files exist
for f in \
  mr-comments-collector.mjs \
  collect-mr-comments.mjs \
  gitlab-client.mjs \
  preprocess-comments.mjs \
  get-diff.mjs \
  .env.example; do
  if [[ ! -f "$SCRIPT_DIR/$f" ]]; then
    echo "Error: source file missing from installer: $f"
    exit 1
  fi
done

# Copy tool files
TOOL_DEST="$TARGET_DIR/.review-collector"
mkdir -p "$TOOL_DEST"

echo ""
echo "Copying tool files..."
for f in \
  mr-comments-collector.mjs \
  collect-mr-comments.mjs \
  gitlab-client.mjs \
  preprocess-comments.mjs \
  get-diff.mjs \
  .env.example; do
  cp "$SCRIPT_DIR/$f" "$TOOL_DEST/$f"
  echo "  ✓ $f"
done

# Copy skills
SKILLS_DEST="$CLAUDE_DIR/skills"
mkdir -p "$SKILLS_DEST"

echo ""
echo "Copying Claude skills..."
for skill in mine-patterns review-commits; do
  cp -r "$SCRIPT_DIR/.claude/skills/$skill" "$SKILLS_DEST/$skill"
  echo "  ✓ $skill"
done
