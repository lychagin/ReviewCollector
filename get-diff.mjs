import { execSync } from "node:child_process";

// ─── Pure functions (exported for testing) ────────────────────────────────────

/**
 * Normalises a raw git ref argument into a two-dot range that both
 * `git log` and `git diff` accept.
 *
 * Supported inputs:
 *   HEAD~3          → HEAD~3..HEAD   (last N commits)
 *   HEAD            → HEAD^..HEAD    (last commit)
 *   abc123          → abc123^..abc123 (single SHA)
 *   abc123..def456  → abc123..def456  (explicit range, pass-through)
 */
export function normalizeRef(raw) {
    if (!raw || raw.trim() === "") throw new Error("Empty git ref");
    const trimmed = raw.trim();
    if (trimmed.includes("..")) return trimmed;
    if (/^HEAD~\d+$/.test(trimmed)) return `${trimmed}..HEAD`;
    return `${trimmed}^..${trimmed}`;
}

/**
 * Parses the raw stdout of `git log --format="%H\t%s\t%an"` into an array
 * of commit objects. SHA is truncated to 7 characters.
 */
export function parseCommits(rawLog) {
    return rawLog
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            const [sha, message, author] = line.split("\t");
            return { sha: sha.slice(0, 7), message, author };
        });
}

// ─── Git wrappers ─────────────────────────────────────────────────────────────

export function runGitLog(range) {
    return execSync(`git log ${range} --format="%H\t%s\t%an"`, { encoding: "utf8" });
}

export function runGitDiff(range) {
    return execSync(`git diff ${range}`, { encoding: "utf8" });
}

export function runGitFilesChanged(range) {
    return execSync(`git diff --name-only ${range}`, { encoding: "utf8" })
        .split("\n")
        .filter(Boolean);
}

/**
 * Returns the full diff payload for a git ref.
 * Throws (from execSync) if the ref is invalid or not in a git repo.
 */
export function buildOutput(rawRef) {
    const range = normalizeRef(rawRef);
    const commits = parseCommits(runGitLog(range));
    const diff = runGitDiff(range);
    const files_changed = runGitFilesChanged(range);
    return { commits, diff, files_changed };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const rawRef = process.argv[2] ?? "HEAD";
    try {
        const output = buildOutput(rawRef);
        process.stdout.write(JSON.stringify(output));
    } catch (e) {
        process.stderr.write(e.message + "\n");
        process.exit(1);
    }
}
