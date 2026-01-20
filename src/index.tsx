#!/usr/bin/env bun
import { createCliRenderer, TextAttributes, type CliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { useState, useEffect } from "react";
import { parseHistory, sessionsToOptions, type Session } from "./lib";

// Store renderer reference for cleanup
let globalRenderer: CliRenderer | null = null;

function cleanExit(code = 0) {
  if (globalRenderer) {
    globalRenderer.stop();
    globalRenderer.destroy();
  }
  process.exit(code);
}

async function resumeSession(sessionId: string, projectPath: string) {
  // Clean up the TUI first
  if (globalRenderer) {
    globalRenderer.stop();
    globalRenderer.destroy();
  }

  // Spawn claude directly in the project directory
  const proc = Bun.spawn(["claude", "--resume", sessionId], {
    cwd: projectPath,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

function App() {
  const [sessions] = useState(() => parseHistory());
  const options = sessionsToOptions(sessions);
  const renderer = useRenderer();

  // Store renderer for cleanup
  useEffect(() => {
    globalRenderer = renderer;
  }, [renderer]);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q") {
      cleanExit(0);
    }
  });

  const handleSelect = (index: number) => {
    const session = sessions[index];
    if (session) {
      resumeSession(session.id, session.cwd);
    }
  };

  if (sessions.length === 0) {
    return (
      <box flexDirection="column" padding={1}>
        <text>No Claude Code sessions found.</text>
        <text attributes={TextAttributes.DIM}>
          Sessions are stored in ~/.claude/projects/
        </text>
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box padding={1} paddingBottom={0}>
        <text attributes={TextAttributes.BOLD}>Claude Sessions</text>
        <text attributes={TextAttributes.DIM}> ({sessions.length})</text>
      </box>
      <box paddingLeft={1} paddingBottom={1}>
        <text attributes={TextAttributes.DIM}>↑/k ↓/j navigate · enter resume · q/esc quit</text>
      </box>
      <select
        options={options}
        selectedIndex={0}
        focused={true}
        showDescription={true}
        flexGrow={1}
        onSelect={handleSelect}
      />
    </box>
  );
}

const renderer = await createCliRenderer();
globalRenderer = renderer;

// Handle Ctrl+C gracefully
process.on("SIGINT", () => cleanExit(0));
process.on("SIGTERM", () => cleanExit(0));

createRoot(renderer).render(<App />);
