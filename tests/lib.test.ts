import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import {
  formatRelativeTime,
  truncate,
  sessionsToOptions,
  parseSessionsFromDir,
  folderNameToPath,
  type Session,
  type SessionIndex,
} from "../src/lib";

describe("formatRelativeTime", () => {
  const now = new Date("2026-01-19T12:00:00Z").getTime();

  test("returns 'just now' for timestamps less than a minute ago", () => {
    const timestamp = now - 30_000; // 30 seconds ago
    expect(formatRelativeTime(timestamp, now)).toBe("just now");
  });

  test("returns minutes for timestamps less than an hour ago", () => {
    const timestamp = now - 5 * 60_000; // 5 minutes ago
    expect(formatRelativeTime(timestamp, now)).toBe("5m ago");
  });

  test("returns hours for timestamps less than a day ago", () => {
    const timestamp = now - 3 * 3600_000; // 3 hours ago
    expect(formatRelativeTime(timestamp, now)).toBe("3h ago");
  });

  test("returns days for timestamps less than a week ago", () => {
    const timestamp = now - 2 * 86400_000; // 2 days ago
    expect(formatRelativeTime(timestamp, now)).toBe("2d ago");
  });

  test("returns formatted date for timestamps over a week ago", () => {
    const timestamp = now - 10 * 86400_000; // 10 days ago
    const result = formatRelativeTime(timestamp, now);
    // Should be a date string, not relative
    expect(result).not.toContain("ago");
  });
});

describe("truncate", () => {
  test("returns string unchanged if under max length", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("truncates and adds ellipsis for long strings", () => {
    expect(truncate("hello world this is a long string", 15)).toBe("hello world th…");
  });

  test("collapses whitespace", () => {
    expect(truncate("hello   world\n\ttest", 50)).toBe("hello world test");
  });

  test("trims leading and trailing whitespace", () => {
    expect(truncate("  hello  ", 10)).toBe("hello");
  });

  test("handles exact length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("folderNameToPath", () => {
  test("converts simple folder name to path", () => {
    expect(folderNameToPath("-home-simon")).toBe("/home/simon");
  });

  test("converts nested folder name to path", () => {
    expect(folderNameToPath("-home-simon-github-project")).toBe("/home/simon/github/project");
  });

  test("handles root path", () => {
    expect(folderNameToPath("-tmp")).toBe("/tmp");
  });
});

describe("sessionsToOptions", () => {
  const now = new Date("2026-01-19T12:00:00Z").getTime();

  test("converts sessions to select options", () => {
    const sessions: Session[] = [
      {
        id: "abc-123",
        title: "Help me write a function",
        firstMessage: "Help me write a function",
        project: "/home/user/project",
        cwd: "/home/user/project",
        timestamp: now - 60_000, // 1 minute ago
        messageCount: 5,
      },
    ];

    const options = sessionsToOptions(sessions, now);

    expect(options).toHaveLength(1);
    expect(options[0].name).toBe("Help me write a function");
    expect(options[0].description).toContain("5 msgs");
    expect(options[0].description).toContain("1m ago");
  });

  test("uses customTitle over firstMessage when available", () => {
    const sessions: Session[] = [
      {
        id: "abc-123",
        title: "My Custom Title",
        firstMessage: "some long first message that would be truncated",
        project: "/home/user/project",
        cwd: "/home/user/project",
        timestamp: now,
        messageCount: 5,
      },
    ];

    const options = sessionsToOptions(sessions, now);
    expect(options[0].name).toBe("My Custom Title");
  });

  test("truncates long titles", () => {
    const longTitle = "a".repeat(100);
    const sessions: Session[] = [
      {
        id: "abc-123",
        title: longTitle,
        firstMessage: "first message",
        project: "/home/user/project",
        cwd: "/home/user/project",
        timestamp: now,
        messageCount: 1,
      },
    ];

    const options = sessionsToOptions(sessions, now);
    expect(options[0].name.length).toBeLessThanOrEqual(60);
    expect(options[0].name).toContain("…");
  });

  test("replaces home directory with ~", () => {
    const sessions: Session[] = [
      {
        id: "abc-123",
        title: "test",
        firstMessage: "test",
        project: process.env.HOME + "/project",
        cwd: process.env.HOME + "/project",
        timestamp: now,
        messageCount: 1,
      },
    ];

    const options = sessionsToOptions(sessions, now);
    expect(options[0].description).toContain("~/project");
  });
});

describe("parseSessionsFromDir", () => {
  const testDir = "/tmp/xtra-code-test-" + Date.now();

  beforeAll(() => {
    // Create test directory structure (folder names match real format: -path-segments)
    mkdirSync(join(testDir, "-home-user-project-a"), { recursive: true });
    mkdirSync(join(testDir, "-home-user-project-b"), { recursive: true });
    mkdirSync(join(testDir, "-empty-project"), { recursive: true });

    // Valid session index
    const indexA: SessionIndex = {
      version: 1,
      entries: [
        {
          sessionId: "session-1",
          firstPrompt: "First session prompt",
          customTitle: "Custom Title for Session 1",
          projectPath: "/home/user/project-a",
          fullPath: join(testDir, "-home-user-project-a", "session-1.jsonl"),
          created: "2026-01-18T10:00:00Z",
          modified: "2026-01-18T12:00:00Z",
          messageCount: 10,
        },
        {
          sessionId: "session-2",
          firstPrompt: "Second session prompt",
          // No customTitle - should fall back to firstPrompt
          projectPath: "/home/user/project-a",
          fullPath: join(testDir, "-home-user-project-a", "session-2.jsonl"),
          created: "2026-01-19T10:00:00Z",
          modified: "2026-01-19T11:00:00Z",
          messageCount: 5,
        },
      ],
    };
    writeFileSync(
      join(testDir, "-home-user-project-a", "sessions-index.json"),
      JSON.stringify(indexA)
    );

    // Another valid session index
    const indexB: SessionIndex = {
      version: 1,
      entries: [
        {
          sessionId: "session-3",
          firstPrompt: "Third session",
          projectPath: "/home/user/project-b",
          fullPath: join(testDir, "-home-user-project-b", "session-3.jsonl"),
          created: "2026-01-17T10:00:00Z",
          modified: "2026-01-17T10:00:00Z",
          messageCount: 3,
        },
      ],
    };
    writeFileSync(
      join(testDir, "-home-user-project-b", "sessions-index.json"),
      JSON.stringify(indexB)
    );

    // Invalid JSON file
    writeFileSync(
      join(testDir, "-empty-project", "sessions-index.json"),
      "not valid json"
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("parses sessions from multiple project directories", () => {
    const sessions = parseSessionsFromDir(testDir);
    expect(sessions).toHaveLength(3);
  });

  test("returns sessions sorted by timestamp descending", () => {
    const sessions = parseSessionsFromDir(testDir);

    // Most recent first
    expect(sessions[0].id).toBe("session-2");
    expect(sessions[1].id).toBe("session-1");
    expect(sessions[2].id).toBe("session-3");
  });

  test("skips directories without sessions-index.json", () => {
    mkdirSync(join(testDir, "-no-index"), { recursive: true });
    const sessions = parseSessionsFromDir(testDir);
    expect(sessions).toHaveLength(3); // Still 3, not affected
  });

  test("skips invalid JSON files gracefully", () => {
    // The empty-project has invalid JSON, should not throw
    const sessions = parseSessionsFromDir(testDir);
    expect(sessions).toHaveLength(3);
  });

  test("returns empty array for non-existent directory", () => {
    const sessions = parseSessionsFromDir("/non/existent/path");
    expect(sessions).toHaveLength(0);
  });

  test("extracts correct session properties", () => {
    const sessions = parseSessionsFromDir(testDir);
    const session = sessions.find(s => s.id === "session-1");

    expect(session).toBeDefined();
    expect(session!.firstMessage).toBe("First session prompt");
    expect(session!.project).toBe("/home/user/project-a");
    expect(session!.messageCount).toBe(10);
    expect(session!.timestamp).toBe(new Date("2026-01-18T12:00:00Z").getTime());
  });

  test("derives cwd from folder name, not projectPath", () => {
    const sessions = parseSessionsFromDir(testDir);
    const session = sessions.find(s => s.id === "session-1");

    expect(session).toBeDefined();
    // Folder is "-home-user-project-a", so cwd should be "/home/user/project/a"
    expect(session!.cwd).toBe("/home/user/project/a");
    // But project should still be the original projectPath
    expect(session!.project).toBe("/home/user/project-a");
  });

  test("uses customTitle when available, falls back to firstPrompt", () => {
    const sessions = parseSessionsFromDir(testDir);

    // session-1 has customTitle
    const session1 = sessions.find(s => s.id === "session-1");
    expect(session1!.title).toBe("Custom Title for Session 1");
    expect(session1!.firstMessage).toBe("First session prompt");

    // session-2 has no customTitle, should use firstPrompt
    const session2 = sessions.find(s => s.id === "session-2");
    expect(session2!.title).toBe("Second session prompt");
  });
});
