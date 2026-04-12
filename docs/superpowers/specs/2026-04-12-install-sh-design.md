# Design: install.sh — Review Collector Installer

**Date:** 2026-04-12  
**Status:** Draft

## Overview

A bash script that installs review-collector into another project. Run from a local clone of review-collector. Designed for sharing the tool with teammates who want to use it in their own projects.

## Interface

```bash
./install.sh <target-dir> [claude-dir]
```

- `target-dir` — root of the target project (required), e.g. `/path/to/terra`
- `claude-dir` — path to the `.claude` directory (optional, defaults to `<target-dir>/.claude`)

## What Gets Copied

### Tool files → `<target>/.review-collector/`

All `.mjs` files except `*.test.mjs`:
- `mr-comments-collector.mjs`
- `collect-mr-comments.mjs`
- `gitlab-client.mjs`
- `preprocess-comments.mjs`
- `get-diff.mjs`
- `.env.example`

`.env` is never copied (contains secrets).

### Skills → `<claude-dir>/skills/`

- `mine-patterns/` (full directory)
- `review-commits/` (full directory)

## Directories Created on Install

```
<target>/.review-collector/
  review/raw/pending/
  review/raw/processed/
  patterns/
```

These are the same directories the tool expects at runtime. Creating them on install avoids first-run errors.

## Script Behavior

1. **Validate** — `target-dir` must exist; exit with clear error if not
2. **Check Node.js** — `node --version` must succeed; warn if missing
3. **Copy tool files** — to `<target>/.review-collector/` (verbose: print each file)
4. **Copy skills** — to `<claude-dir>/skills/`
5. **Create directories** — `mkdir -p` for all runtime dirs
6. **Print instructions** — tell user to copy `.env.example` → `.review-collector/.env` and fill in `GITLAB_TOKEN` and `GITLAB_URL`

## What the Script Does NOT Do

- Does not touch `.env` if it already exists (safe to re-run)
- Does not clone git or download anything
- Does not install dependencies (none needed — stdlib only)
- Does not modify `CLAUDE.md` of the target project

## Re-running (Manual Update)

Re-running `install.sh` on an existing installation overwrites tool files and skills with the latest version from the local clone. `.env` is preserved. Data directories (`review/`, `patterns/`) are untouched.

## File Layout After Install

```
terra/
  .review-collector/
    mr-comments-collector.mjs
    collect-mr-comments.mjs
    gitlab-client.mjs
    preprocess-comments.mjs
    get-diff.mjs
    .env.example
    .env                    ← filled in by user, never overwritten
    review/
      raw/
        pending/            ← new exports go here
        processed/          ← auto-moved after processing
    patterns/
      mining-state.json
      threads.jsonl
      review-patterns.json
      review-patterns.md
  .claude/
    skills/
      mine-patterns/
      review-commits/
```
