#!/usr/bin/env bun
/**
 * Auto-titles Claude Code sessions using local Qwen LLM
 *
 * Usage:
 *   bun run src/session-titler.ts           # Title all untitled sessions
 *   bun run src/session-titler.ts --dry-run # Preview without updating
 *
 * Auto-runs via Claude Code SessionEnd hook (~/.claude/hooks/session-title.ts)
 */

import { readFile, writeFile, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { SessionIndexEntry, SessionIndex } from "./lib";

// Config - exported for testing
export const CONFIG = {
  qwenUrl: "http://localhost:8090/v1/chat/completions",
  qwenModel: "Qwen3-4B-Q4_K_M.gguf",
  maxChars: 4000, // ~1000 tokens
  numMessages: 10, // Last N messages to use
  maxTokens: 50,
  temperature: 0.5,
  claudeDir: join(homedir(), ".claude"),
  projectsDir: join(homedir(), ".claude/projects"),
};

// Prompt template - exported for customization
export const TITLE_PROMPT = (conversation: string) =>
  `Generate a concise 3-6 word title summarizing this conversation:

${conversation}

Reply with ONLY the title, no quotes or explanation. /no_think`;

export interface Message {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
}

export async function generateTitle(conversation: string): Promise<string | null> {
  const prompt = TITLE_PROMPT(conversation);

  try {
    const response = await fetch(CONFIG.qwenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONFIG.qwenModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: CONFIG.maxTokens,
        temperature: CONFIG.temperature,
      }),
    });

    if (!response.ok) {
      console.error(`Qwen API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    // Qwen3 sometimes puts the answer in reasoning_content instead of content
    const content = message?.content?.trim() || message?.reasoning_content?.trim();
    return content || null;
  } catch (err) {
    console.error(`Failed to call Qwen: ${err}`);
    return null;
  }
}

export function extractConversation(messages: Message[]): string[] {
  const conversation: string[] = [];

  for (const msg of messages) {
    if (msg.type === "user") {
      const content = msg.message?.content;
      if (typeof content === "string" && content.trim()) {
        conversation.push(`User: ${content.slice(0, 300)}`);
      }
    } else if (msg.type === "assistant") {
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text?.trim()) {
            conversation.push(`Assistant: ${block.text.slice(0, 200)}`);
            break;
          }
        }
      }
    }
  }

  return conversation;
}

export async function loadSessionMessages(sessionPath: string): Promise<Message[]> {
  try {
    const content = await readFile(sessionPath, "utf-8");
    const lines = content.trim().split("\n");
    return lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: "unknown" };
      }
    });
  } catch {
    return [];
  }
}

export function prepareConversationText(conversation: string[], maxChars: number, numMessages: number): string {
  const recentConversation = conversation.slice(-numMessages);
  let combined = recentConversation.join("\n");

  // Truncate from start if over limit (keep most recent)
  if (combined.length > maxChars) {
    combined = "..." + combined.slice(-(maxChars - 3));
  }

  return combined;
}

export function needsRetitling(entry: SessionIndexEntry): boolean {
  // No title yet - needs titling
  if (!entry.customTitle) return false;
  // No titledAt timestamp - legacy entry, skip unless forced
  if (!entry.titledAt) return false;
  // Session was modified after it was titled - needs retitling
  const modifiedTime = new Date(entry.modified).getTime();
  const titledTime = new Date(entry.titledAt).getTime();
  return modifiedTime > titledTime;
}

export function shouldProcessSession(entry: SessionIndexEntry): boolean {
  // Skip invalid entries
  if (!entry.firstPrompt?.trim() || entry.firstPrompt === "No prompt") return false;
  if (entry.messageCount < 3) return false;

  // Process if: no title, OR needs retitling (modified after titled)
  if (!entry.customTitle) return true;
  if (needsRetitling(entry)) return true;

  return false;
}

async function findSessionsIndex(): Promise<string[]> {
  const indexFiles: string[] = [];

  try {
    const projects = await readdir(CONFIG.projectsDir);
    for (const project of projects) {
      const indexPath = join(CONFIG.projectsDir, project, "sessions-index.json");
      try {
        await readFile(indexPath);
        indexFiles.push(indexPath);
      } catch {
        // File doesn't exist
      }
    }
  } catch (err) {
    console.error(`Error reading projects dir: ${err}`);
  }

  return indexFiles;
}

async function processSession(
  entry: SessionIndexEntry,
  dryRun: boolean
): Promise<{ title: string; titledAt: string; updated: boolean } | null> {
  if (!shouldProcessSession(entry)) {
    return null;
  }

  const messages = await loadSessionMessages(entry.fullPath);
  const conversation = extractConversation(messages);

  if (conversation.length === 0) {
    return null;
  }

  const isRetitle = needsRetitling(entry);
  const combined = prepareConversationText(conversation, CONFIG.maxChars, CONFIG.numMessages);
  const estTokens = Math.floor(combined.length / 4);
  const action = isRetitle ? "Retitling" : "Processing";
  console.log(
    `  ${action} ${entry.sessionId.slice(0, 8)}... (${conversation.length} msgs, ~${estTokens} tokens)`
  );

  if (dryRun) {
    const dryAction = isRetitle ? "retitle" : "title";
    console.log(`  [DRY RUN] Would ${dryAction}: ${entry.firstPrompt.slice(0, 50)}...`);
    return null;
  }

  const title = await generateTitle(combined);
  if (!title) {
    console.log(`  ⚠️  Failed to generate title`);
    return null;
  }

  const prefix = isRetitle ? "🔄" : "✅";
  console.log(`  ${prefix} Title: ${title}`);
  return { title, titledAt: new Date().toISOString(), updated: true };
}

async function processIndexFile(indexPath: string, dryRun: boolean): Promise<number> {
  console.log(`\nProcessing: ${indexPath}`);

  const content = await readFile(indexPath, "utf-8");
  const index: SessionIndex = JSON.parse(content);

  // Find sessions that need titling or retitling
  const toProcess = index.entries.filter((e) => shouldProcessSession(e));
  const needsNewTitle = toProcess.filter((e) => !e.customTitle).length;
  const needsRetitle = toProcess.filter((e) => needsRetitling(e)).length;

  if (needsNewTitle > 0) {
    console.log(`Found ${needsNewTitle} untitled sessions`);
  }
  if (needsRetitle > 0) {
    console.log(`Found ${needsRetitle} sessions needing retitle (modified since titled)`);
  }
  if (toProcess.length === 0) {
    console.log(`No sessions need titling (${index.entries.length} total)`);
  }

  let updatedCount = 0;

  for (const entry of toProcess) {
    const result = await processSession(entry, dryRun);
    if (result?.updated) {
      entry.customTitle = result.title;
      entry.titledAt = result.titledAt;
      updatedCount++;
    }
  }

  if (updatedCount > 0 && !dryRun) {
    await writeFile(indexPath, JSON.stringify(index, null, 2));
    console.log(`\n💾 Saved ${updatedCount} titles to ${indexPath}`);
  }

  return updatedCount;
}

export async function runOnce(dryRun: boolean) {
  console.log("🏷️  Claude Session Titler");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "UPDATE"}\n`);

  const indexFiles = await findSessionsIndex();
  console.log(`Found ${indexFiles.length} project index files`);

  let totalUpdated = 0;
  for (const indexPath of indexFiles) {
    totalUpdated += await processIndexFile(indexPath, dryRun);
  }

  console.log(`\n✨ Done! Updated ${totalUpdated} sessions.`);
}

// Main - only run when executed directly, not when imported
const isMain = import.meta.main ?? process.argv[1]?.endsWith("session-titler.ts");

if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  runOnce(dryRun);
}
