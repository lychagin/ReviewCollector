# install.sh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a bash script that installs review-collector (tool files + Claude skills) into another project directory.

**Architecture:** A single `install.sh` at the repo root. It validates inputs, copies `.mjs` files and skills into the target project, creates runtime directories, and prints setup instructions. Safe to re-run — never overwrites `.env`.

**Tech Stack:** Bash, standard Unix utilities (`cp`, `mkdir`, `rsync` not required — plain `cp -r`)

---

## File Structure

- **Create:** `install.sh` — the installer script (root of review-collector)

---

### Task 1: Argument parsing and validation

**Files:**
- Create: `install.sh`

- [ ] **Step 1: Create the script with shebang and argument parsing**

```bash
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
```

- [ ] **Step 2: Make executable and verify it runs**

```bash
chmod +x install.sh
./install.sh
# Expected: "Error: target-dir is required" + usage
./install.sh /nonexistent/path
# Expected: "Error: target directory does not exist: /nonexistent/path"
./install.sh /tmp
# Expected: "Installing review-collector into: /tmp" (then fails — that's fine for now)
```

- [ ] **Step 3: Commit**

```bash
git add install.sh
git commit -m "feat: add install.sh with argument parsing and validation"
```

---

### Task 2: Node.js check and tool file copy

**Files:**
- Modify: `install.sh`

- [ ] **Step 1: Add Node.js check after the validation block**

```bash
# Check Node.js
if ! command -v node &>/dev/null; then
  echo "Warning: node not found. review-collector requires Node.js 18+."
  echo "Install from https://nodejs.org before using the tool."
fi
```

- [ ] **Step 2: Add tool file copy**

```bash
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
```

- [ ] **Step 3: Test the copy**

```bash
mkdir -p /tmp/test-terra
./install.sh /tmp/test-terra
ls /tmp/test-terra/.review-collector/
# Expected: collect-mr-comments.mjs  get-diff.mjs  gitlab-client.mjs
#           mr-comments-collector.mjs  preprocess-comments.mjs  .env.example
rm -rf /tmp/test-terra
```

- [ ] **Step 4: Commit**

```bash
git add install.sh
git commit -m "feat: install.sh copies tool files to target/.review-collector/"
```

---

### Task 3: Skills copy

**Files:**
- Modify: `install.sh`

- [ ] **Step 1: Add skills copy after tool file copy**

```bash
# Copy skills
SKILLS_DEST="$CLAUDE_DIR/skills"
mkdir -p "$SKILLS_DEST"

echo ""
echo "Copying Claude skills..."
for skill in mine-patterns review-commits; do
  cp -r "$SCRIPT_DIR/.claude/skills/$skill" "$SKILLS_DEST/$skill"
  echo "  ✓ $skill"
done
```

- [ ] **Step 2: Test skills copy**

```bash
mkdir -p /tmp/test-terra
./install.sh /tmp/test-terra
ls /tmp/test-terra/.claude/skills/
# Expected: mine-patterns  review-commits
ls /tmp/test-terra/.claude/skills/mine-patterns/
# Expected: SKILL.md
rm -rf /tmp/test-terra
```

- [ ] **Step 3: Test custom claude-dir**

```bash
mkdir -p /tmp/test-terra /tmp/my-claude
./install.sh /tmp/test-terra /tmp/my-claude
ls /tmp/my-claude/skills/
# Expected: mine-patterns  review-commits
rm -rf /tmp/test-terra /tmp/my-claude
```

- [ ] **Step 4: Commit**

```bash
git add install.sh
git commit -m "feat: install.sh copies Claude skills to target .claude/skills/"
```

---

### Task 4: Create runtime directories and print instructions

**Files:**
- Modify: `install.sh`

- [ ] **Step 1: Add runtime directory creation**

```bash
# Create runtime directories
echo ""
echo "Creating runtime directories..."
mkdir -p "$TOOL_DEST/review/raw/pending"
mkdir -p "$TOOL_DEST/review/raw/processed"
mkdir -p "$TOOL_DEST/patterns"
echo "  ✓ .review-collector/review/raw/pending/"
echo "  ✓ .review-collector/review/raw/processed/"
echo "  ✓ .review-collector/patterns/"
```

- [ ] **Step 2: Add .env preservation logic and final instructions**

```bash
# Print setup instructions
echo ""
echo "========================================="
echo "  review-collector installed successfully"
echo "========================================="
echo ""

if [[ -f "$TOOL_DEST/.env" ]]; then
  echo "  .env already exists — skipped (your config is preserved)"
else
  echo "  Next steps:"
  echo "  1. Copy the env template:"
  echo "     cp $TOOL_DEST/.env.example $TOOL_DEST/.env"
  echo "  2. Fill in your credentials in $TOOL_DEST/.env:"
  echo "     GITLAB_TOKEN=<your token>"
  echo "     GITLAB_URL=<your gitlab url>"
fi

echo ""
echo "  Skills available in Claude Code:"
echo "    /mine-patterns   — analyze MR comments for review patterns"
echo "    /review-commits  — review commits against patterns"
echo ""
```

- [ ] **Step 3: Full end-to-end test**

```bash
mkdir -p /tmp/test-terra
./install.sh /tmp/test-terra

# Verify directories
ls /tmp/test-terra/.review-collector/review/raw/pending/   # empty, no error
ls /tmp/test-terra/.review-collector/review/raw/processed/ # empty, no error
ls /tmp/test-terra/.review-collector/patterns/             # empty, no error

# Verify .env not created
ls /tmp/test-terra/.review-collector/.env 2>&1
# Expected: "No such file or directory"

# Verify .env.example present
ls /tmp/test-terra/.review-collector/.env.example
# Expected: the file exists

rm -rf /tmp/test-terra
```

- [ ] **Step 4: Test re-run preserves .env**

```bash
mkdir -p /tmp/test-terra
./install.sh /tmp/test-terra
echo "GITLAB_TOKEN=secret" > /tmp/test-terra/.review-collector/.env
./install.sh /tmp/test-terra
cat /tmp/test-terra/.review-collector/.env
# Expected: "GITLAB_TOKEN=secret" (unchanged)
# Output should show: ".env already exists — skipped (your config is preserved)"
rm -rf /tmp/test-terra
```

- [ ] **Step 5: Commit**

```bash
git add install.sh
git commit -m "feat: install.sh creates runtime dirs and prints setup instructions"
```

---

### Task 5: Add README section for installation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read existing README to find the right place to insert**

Read `README.md` and find where to add an "Installation" or "Using in your project" section.

- [ ] **Step 2: Add installation section**

Add after the existing intro/overview section:

```markdown
## Installing into another project

To use review-collector in your project, run `install.sh` from a local clone:

```bash
git clone <repo-url> review-collector
cd review-collector
./install.sh /path/to/your-project
```

Optionally specify a custom `.claude` directory:

```bash
./install.sh /path/to/your-project /path/to/your-project/.claude
```

The script will:
- Copy tool files to `your-project/.review-collector/`
- Copy Claude skills to `your-project/.claude/skills/`
- Create runtime directories

After install, copy and fill in your credentials:

```bash
cp your-project/.review-collector/.env.example your-project/.review-collector/.env
# Edit .env: set GITLAB_TOKEN and GITLAB_URL
```

Then use Claude Code skills in your project:
- `/mine-patterns` — extract and analyze MR review patterns
- `/review-commits` — review your commits against the patterns
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add installation section to README"
```
