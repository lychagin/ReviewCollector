import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

export const SCHEMA_VERSION = "1.0";

/**
 * Given an array of flat JSONL records sharing the same discussion_id,
 * returns a single thread object for threads.jsonl.
 * Records must be sorted by reply_index_in_discussion ascending (as exported).
 */
export function reconstructThread(notes) {
    const root = notes.find((n) => n.is_root_note) ?? notes[0];
    const replies = notes
        .filter((n) => !n.is_root_note)
        .map((n) => n.note_body);

    const { code_snippets: rootSnippets, text: rootText } = splitCodeFences(root.note_body);
    const allSnippets = [...rootSnippets];
    const cleanReplies = replies.map((r) => {
        const { code_snippets, text } = splitCodeFences(r);
        allSnippets.push(...code_snippets);
        return normalizeText(text);
    });

    return {
        discussion_id: root.discussion_id,
        kind: root.discussion_kind,
        file_path: root.file_path ?? null,
        root_comment: normalizeText(rootText),
        replies: cleanReplies.filter(Boolean),
        code_snippets: allSnippets.filter(Boolean),
        resolved: root.discussion_resolved,
        mr_iid: root.mr_iid,
        source_file: root._source_file,
    };
}

/**
 * Strips markdown formatting from text (bold, italic, headers, links, inline code).
 * Does NOT strip code fences — use splitCodeFences for that first.
 */
export function normalizeText(text) {
    return text
        .replace(/```[\s\S]*?```/g, "")   // remove any leftover code fences
        .replace(/`[^`]+`/g, (m) => m.slice(1, -1))  // inline code → plain
        .replace(/\*\*(.+?)\*\*/g, "$1")  // bold
        .replace(/\*(.+?)\*/g, "$1")      // italic
        .replace(/^#{1,6}\s+/gm, "")      // headers
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // links
        .replace(/\n{3,}/g, "\n\n")       // collapse blank lines
        .trim();
}

/**
 * Splits text into code fence blocks and the remaining text.
 * Returns { text: string, code_snippets: string[] }.
 */
export function splitCodeFences(text) {
    const code_snippets = [];
    const cleaned = text.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code) => {
        code_snippets.push(code.trim());
        return "";
    });
    return { text: cleaned.trim(), code_snippets };
}
