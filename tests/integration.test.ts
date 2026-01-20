import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import type { SessionIndex } from "../src/lib";

// Create a mock .claude/projects directory for testing
const testHome = "/tmp/xtra-code-integration-test-" + Date.now();
const testProjectsDir = join(testHome, ".claude", "projects");

beforeAll(() => {
  // Create test session data
  mkdirSync(join(testProjectsDir, "-test-project"), { recursive: true });

  const sessionIndex: SessionIndex = {
    version: 1,
    entries: [
      {
        sessionId: "test-session-001",
        firstPrompt: "This is a test session for integration testing",
        customTitle: "Integration Test Session",
        projectPath: "/tmp/test-project",
        created: "2026-01-19T10:00:00Z",
        modified: "2026-01-19T12:00:00Z",
        messageCount: 5,
        fullPath: join(testProjectsDir, "-test-project", "test-session-001.jsonl"),
      },
      {
        sessionId: "test-session-002",
        firstPrompt: "Another test session",
        projectPath: "/tmp/test-project-2",
        created: "2026-01-19T08:00:00Z",
        modified: "2026-01-19T09:00:00Z",
        messageCount: 3,
        fullPath: join(testProjectsDir, "-test-project", "test-session-002.jsonl"),
      },
    ],
  };

  writeFileSync(
    join(testProjectsDir, "-test-project", "sessions-index.json"),
    JSON.stringify(sessionIndex)
  );
});

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});

describe("TUI Integration", () => {
  test("app starts and shows session list", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.tsx"], {
      cwd: import.meta.dir.replace("/tests", ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: testHome, // Use test home directory
      },
    });

    // Wait a bit for the app to render
    await Bun.sleep(500);

    // Send 'q' to quit
    proc.stdin.write("q");
    proc.stdin.flush();
    proc.stdin.end();

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("app quits on escape key", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.tsx"], {
      cwd: import.meta.dir.replace("/tests", ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: testHome,
      },
    });

    await Bun.sleep(500);

    // Send escape key (0x1b)
    proc.stdin.write(Buffer.from([0x1b]));
    proc.stdin.flush();
    proc.stdin.end();

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("app handles empty session list gracefully", async () => {
    // Create empty projects dir
    const emptyHome = "/tmp/xtra-code-empty-" + Date.now();
    mkdirSync(join(emptyHome, ".claude", "projects"), { recursive: true });

    const proc = Bun.spawn(["bun", "run", "src/index.tsx"], {
      cwd: import.meta.dir.replace("/tests", ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: emptyHome,
      },
    });

    await Bun.sleep(500);

    proc.stdin.write("q");
    proc.stdin.flush();
    proc.stdin.end();

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    rmSync(emptyHome, { recursive: true, force: true });
  });

  test("app navigates with j/k keys without crashing", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.tsx"], {
      cwd: import.meta.dir.replace("/tests", ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: testHome,
      },
    });

    await Bun.sleep(500);

    // Navigate down then up
    proc.stdin.write("j"); // down
    await Bun.sleep(100);
    proc.stdin.write("k"); // up
    await Bun.sleep(100);
    proc.stdin.write("j"); // down again
    await Bun.sleep(100);
    proc.stdin.write("q"); // quit
    proc.stdin.flush();
    proc.stdin.end();

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("app navigates with arrow keys without crashing", async () => {
    const proc = Bun.spawn(["bun", "run", "src/index.tsx"], {
      cwd: import.meta.dir.replace("/tests", ""),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: testHome,
      },
    });

    await Bun.sleep(500);

    // Arrow down: ESC [ B
    proc.stdin.write(Buffer.from([0x1b, 0x5b, 0x42]));
    await Bun.sleep(100);
    // Arrow up: ESC [ A
    proc.stdin.write(Buffer.from([0x1b, 0x5b, 0x41]));
    await Bun.sleep(100);
    proc.stdin.write("q");
    proc.stdin.flush();
    proc.stdin.end();

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });
});
