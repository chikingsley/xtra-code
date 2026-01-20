import { readFileSync, existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface SessionIndexEntry {
  sessionId: string;
  firstPrompt: string;
  projectPath: string;
  created: string;
  modified: string;
  messageCount: number;
  fullPath: string;
  customTitle?: string;
  titledAt?: string; // ISO timestamp of when title was generated
}

export interface SessionIndex {
  version: number;
  entries: SessionIndexEntry[];
}

export interface Session {
  id: string;
  title: string; // customTitle if available, otherwise firstPrompt
  firstMessage: string;
  project: string; // Display path (from projectPath field)
  cwd: string; // Actual cwd for resume (derived from folder name)
  timestamp: number;
  messageCount: number;
}

// Convert folder name like "-home-simon-github-project" to "/home/simon/github/project"
export function folderNameToPath(folderName: string): string {
  // Remove leading dash and replace remaining dashes with slashes
  return folderName.replace(/^-/, "/").replace(/-/g, "/");
}

export function parseSessionsFromDir(projectsDir: string): Session[] {
  if (!existsSync(projectsDir)) {
    return [];
  }

  const sessions: Session[] = [];
  const projectDirs = readdirSync(projectsDir);

  for (const dir of projectDirs) {
    const indexPath = join(projectsDir, dir, "sessions-index.json");

    if (!existsSync(indexPath)) continue;

    try {
      const content = readFileSync(indexPath, "utf-8");
      const index: SessionIndex = JSON.parse(content);

      // The cwd for resume is derived from folder name, not projectPath
      const cwdPath = folderNameToPath(dir);

      for (const entry of index.entries) {
        sessions.push({
          id: entry.sessionId,
          title: entry.customTitle || entry.firstPrompt,
          firstMessage: entry.firstPrompt,
          project: entry.projectPath, // Display the actual project path
          cwd: cwdPath, // But use folder-derived path for resume
          timestamp: new Date(entry.modified).getTime(),
          messageCount: entry.messageCount,
        });
      }
    } catch {
      // Skip invalid index files
    }
  }

  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}

export function parseHistory(): Session[] {
  const projectsDir = join(homedir(), ".claude", "projects");
  return parseSessionsFromDir(projectsDir);
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

export function truncate(str: string, maxLen: number): string {
  const cleaned = str.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1) + "…";
}

export interface SelectOption {
  name: string;
  description: string;
}

export function sessionsToOptions(sessions: Session[], now = Date.now()): SelectOption[] {
  return sessions.map(s => ({
    name: truncate(s.title, 60),
    description: `${s.project.replace(homedir(), "~")} · ${s.messageCount} msgs · ${formatRelativeTime(s.timestamp, now)}`,
  }));
}
