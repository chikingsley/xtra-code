import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
  CONFIG,
  TITLE_PROMPT,
  extractConversation,
  loadSessionMessages,
  prepareConversationText,
  shouldProcessSession,
  needsRetitling,
  generateTitle,
  type Message,
} from "../src/session-titler";
import type { SessionIndexEntry } from "../src/lib";

describe("extractConversation", () => {
  test("extracts user messages with string content", () => {
    const messages: Message[] = [
      { type: "user", message: { role: "user", content: "Hello world" } },
    ];

    const result = extractConversation(messages);

    expect(result).toEqual(["User: Hello world"]);
  });

  test("extracts assistant messages with text blocks", () => {
    const messages: Message[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello there!" }],
        },
      },
    ];

    const result = extractConversation(messages);

    expect(result).toEqual(["Assistant: Hello there!"]);
  });

  test("handles mixed conversation", () => {
    const messages: Message[] = [
      { type: "user", message: { content: "What is 2+2?" } },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "The answer is 4." }] },
      },
      { type: "user", message: { content: "Thanks!" } },
    ];

    const result = extractConversation(messages);

    expect(result).toHaveLength(3);
    expect(result[0]).toBe("User: What is 2+2?");
    expect(result[1]).toBe("Assistant: The answer is 4.");
    expect(result[2]).toBe("User: Thanks!");
  });

  test("skips non-user/assistant message types", () => {
    const messages: Message[] = [
      { type: "summary", message: { content: "Some summary" } },
      { type: "file-history-snapshot" },
      { type: "user", message: { content: "Real message" } },
    ];

    const result = extractConversation(messages);

    expect(result).toEqual(["User: Real message"]);
  });

  test("skips empty content", () => {
    const messages: Message[] = [
      { type: "user", message: { content: "" } },
      { type: "user", message: { content: "   " } },
      { type: "user", message: { content: "Valid" } },
    ];

    const result = extractConversation(messages);

    expect(result).toEqual(["User: Valid"]);
  });

  test("truncates long user messages to 300 chars", () => {
    const longMessage = "x".repeat(500);
    const messages: Message[] = [
      { type: "user", message: { content: longMessage } },
    ];

    const result = extractConversation(messages);

    expect(result[0]).toBe(`User: ${"x".repeat(300)}`);
  });

  test("truncates long assistant messages to 200 chars", () => {
    const longMessage = "y".repeat(400);
    const messages: Message[] = [
      {
        type: "assistant",
        message: { content: [{ type: "text", text: longMessage }] },
      },
    ];

    const result = extractConversation(messages);

    expect(result[0]).toBe(`Assistant: ${"y".repeat(200)}`);
  });

  test("only takes first text block from assistant", () => {
    const messages: Message[] = [
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "First block" },
            { type: "text", text: "Second block" },
          ],
        },
      },
    ];

    const result = extractConversation(messages);

    expect(result).toEqual(["Assistant: First block"]);
  });

  test("skips assistant tool_use blocks", () => {
    const messages: Message[] = [
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", text: "some tool" },
            { type: "text", text: "Actual response" },
          ],
        },
      },
    ];

    const result = extractConversation(messages);

    expect(result).toEqual(["Assistant: Actual response"]);
  });
});

describe("prepareConversationText", () => {
  test("takes last N messages", () => {
    const conversation = ["msg1", "msg2", "msg3", "msg4", "msg5"];

    const result = prepareConversationText(conversation, 1000, 3);

    expect(result).toBe("msg3\nmsg4\nmsg5");
  });

  test("handles fewer messages than numMessages", () => {
    const conversation = ["msg1", "msg2"];

    const result = prepareConversationText(conversation, 1000, 10);

    expect(result).toBe("msg1\nmsg2");
  });

  test("truncates from start when over maxChars", () => {
    const conversation = ["a".repeat(100), "b".repeat(100), "c".repeat(100)];

    const result = prepareConversationText(conversation, 150, 10);

    expect(result.startsWith("...")).toBe(true);
    expect(result.length).toBe(150);
    expect(result.endsWith("c".repeat(100))).toBe(true);
  });

  test("does not truncate when under maxChars", () => {
    const conversation = ["short", "messages"];

    const result = prepareConversationText(conversation, 1000, 10);

    expect(result).toBe("short\nmessages");
    expect(result.startsWith("...")).toBe(false);
  });
});

describe("needsRetitling", () => {
  const baseEntry: SessionIndexEntry = {
    sessionId: "test-123",
    fullPath: "/path/to/session.jsonl",
    firstPrompt: "Hello world",
    messageCount: 10,
    created: "2026-01-01T10:00:00Z",
    modified: "2026-01-01T12:00:00Z",
    projectPath: "/home/user",
  };

  test("returns false if no customTitle", () => {
    expect(needsRetitling(baseEntry)).toBe(false);
  });

  test("returns false if has customTitle but no titledAt", () => {
    const entry = { ...baseEntry, customTitle: "Old Title" };
    expect(needsRetitling(entry)).toBe(false);
  });

  test("returns false if modified before titledAt", () => {
    const entry = {
      ...baseEntry,
      customTitle: "Old Title",
      modified: "2026-01-01T12:00:00Z",
      titledAt: "2026-01-01T14:00:00Z", // Titled after modified
    };
    expect(needsRetitling(entry)).toBe(false);
  });

  test("returns true if modified after titledAt", () => {
    const entry = {
      ...baseEntry,
      customTitle: "Old Title",
      modified: "2026-01-01T16:00:00Z", // Modified after titled
      titledAt: "2026-01-01T14:00:00Z",
    };
    expect(needsRetitling(entry)).toBe(true);
  });
});

describe("shouldProcessSession", () => {
  const baseEntry: SessionIndexEntry = {
    sessionId: "test-123",
    fullPath: "/path/to/session.jsonl",
    firstPrompt: "Hello world",
    messageCount: 10,
    created: "2026-01-01T10:00:00Z",
    modified: "2026-01-01T12:00:00Z",
    projectPath: "/home/user",
  };

  test("returns true for valid untitled session", () => {
    expect(shouldProcessSession(baseEntry)).toBe(true);
  });

  test("returns false if has customTitle and titledAt is recent", () => {
    const entry = {
      ...baseEntry,
      customTitle: "Existing Title",
      titledAt: "2026-01-01T14:00:00Z", // Titled after modified
    };
    expect(shouldProcessSession(entry)).toBe(false);
  });

  test("returns true if has customTitle but needs retitling", () => {
    const entry = {
      ...baseEntry,
      customTitle: "Existing Title",
      modified: "2026-01-01T16:00:00Z", // Modified after titled
      titledAt: "2026-01-01T14:00:00Z",
    };
    expect(shouldProcessSession(entry)).toBe(true);
  });

  test("returns false if firstPrompt is empty", () => {
    const entry = { ...baseEntry, firstPrompt: "" };

    expect(shouldProcessSession(entry)).toBe(false);
  });

  test("returns false if firstPrompt is whitespace", () => {
    const entry = { ...baseEntry, firstPrompt: "   " };

    expect(shouldProcessSession(entry)).toBe(false);
  });

  test("returns false if firstPrompt is 'No prompt'", () => {
    const entry = { ...baseEntry, firstPrompt: "No prompt" };

    expect(shouldProcessSession(entry)).toBe(false);
  });

  test("returns false if messageCount < 3", () => {
    const entry = { ...baseEntry, messageCount: 2 };

    expect(shouldProcessSession(entry)).toBe(false);
  });

  test("returns true if messageCount is exactly 3", () => {
    const entry = { ...baseEntry, messageCount: 3 };

    expect(shouldProcessSession(entry)).toBe(true);
  });
});

describe("TITLE_PROMPT", () => {
  test("generates prompt with conversation", () => {
    const conversation = "User: Hello\nAssistant: Hi there!";
    const prompt = TITLE_PROMPT(conversation);

    expect(prompt).toContain(conversation);
    expect(prompt).toContain("3-6 word title");
    expect(prompt).toContain("/no_think");
  });
});

describe("loadSessionMessages", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "session-titler-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("loads valid JSONL file", async () => {
    const sessionPath = join(tempDir, "valid.jsonl");
    const content = [
      JSON.stringify({ type: "user", message: { content: "Hello" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hi" }] } }),
    ].join("\n");

    await writeFile(sessionPath, content);

    const result = await loadSessionMessages(sessionPath);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("user");
    expect(result[1].type).toBe("assistant");
  });

  test("handles invalid JSON lines gracefully", async () => {
    const sessionPath = join(tempDir, "invalid.jsonl");
    const content = [
      JSON.stringify({ type: "user", message: { content: "Valid" } }),
      "not valid json",
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Also valid" }] } }),
    ].join("\n");

    await writeFile(sessionPath, content);

    const result = await loadSessionMessages(sessionPath);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("user");
    expect(result[1].type).toBe("unknown");
    expect(result[2].type).toBe("assistant");
  });

  test("returns empty array for non-existent file", async () => {
    const result = await loadSessionMessages("/nonexistent/path.jsonl");

    expect(result).toEqual([]);
  });

  test("handles empty file", async () => {
    const sessionPath = join(tempDir, "empty.jsonl");
    await writeFile(sessionPath, "");

    const result = await loadSessionMessages(sessionPath);

    expect(result).toHaveLength(1);
  });
});

describe("generateTitle (integration)", () => {
  const isQwenAvailable = async (): Promise<boolean> => {
    try {
      const response = await fetch(`${CONFIG.qwenUrl.replace("/chat/completions", "/models")}`);
      return response.ok;
    } catch {
      return false;
    }
  };

  test("generates title from conversation", async () => {
    if (!(await isQwenAvailable())) {
      console.log("  ⚠️  Skipping: Qwen server not available");
      return;
    }

    const conversation = `User: How do I set up Docker?
Assistant: I can help you set up Docker. First, install it with apt.
User: Thanks, that worked!`;

    const title = await generateTitle(conversation);

    expect(title).not.toBeNull();
    expect(title!.length).toBeGreaterThan(0);
    expect(title!.length).toBeLessThan(100);
  });

  test("handles reasoning_content fallback", async () => {
    if (!(await isQwenAvailable())) {
      console.log("  ⚠️  Skipping: Qwen server not available");
      return;
    }

    const conversation = "User: Test message for title generation";

    const title = await generateTitle(conversation);

    expect(title).not.toBeNull();
  });

  test("returns null on connection error", async () => {
    const originalUrl = CONFIG.qwenUrl;
    (CONFIG as any).qwenUrl = "http://localhost:99999/v1/chat/completions";

    const originalError = console.error;
    console.error = () => {};

    const title = await generateTitle("Test conversation");

    console.error = originalError;
    expect(title).toBeNull();

    (CONFIG as any).qwenUrl = originalUrl;
  });
});

describe("end-to-end flow", () => {
  test("full extraction and preparation pipeline", () => {
    const messages: Message[] = [
      { type: "summary", message: { content: "Previous context" } },
      { type: "file-history-snapshot" },
      { type: "user", message: { content: "Can you help me with Docker?" } },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Sure! What do you need help with?" }] },
      },
      { type: "user", message: { content: "How do I run a container?" } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", text: "bash" },
            { type: "text", text: "Use docker run <image>" },
          ],
        },
      },
      { type: "user", message: { content: "Thanks!" } },
    ];

    const conversation = extractConversation(messages);
    const text = prepareConversationText(conversation, 1000, 5);

    expect(conversation).toHaveLength(5);
    expect(text).toContain("User: Can you help me with Docker?");
    expect(text).toContain("Assistant: Use docker run <image>");
    expect(text).not.toContain("summary");
    expect(text).not.toContain("tool_use");
  });
});
