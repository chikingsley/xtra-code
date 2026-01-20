# xtra-code

Tools for working with Claude Code sessions.

## Features

### Session Picker (`ccs`)

TUI for browsing and resuming Claude Code sessions.

```bash
ccs
```

- Lists all sessions from `~/.claude/projects/`
- Shows custom titles (if set) or first prompt
- Navigate with `↑/k` `↓/j`, select with `Enter`, quit with `q/Esc`
- Resumes selected session with `claude --resume`

### Auto-Titler

Automatically generates titles for Claude Code sessions using a local Qwen LLM.

Runs via Claude Code's `SessionEnd` hook - no manual intervention needed. When a session ends, it:

- Titles any untitled sessions
- Retitles sessions that were modified after their last title was generated

Titles are generated from the **last 10 messages** of each conversation, giving context about where the conversation ended up rather than where it started.

**Requirements:**

- Local LLM server at `http://localhost:8090` (llama-server with Qwen3)

## Installation

```bash
bun install
bun link
```

This makes `ccs` available globally.

## Development

```bash
bun run dev      # Watch mode
bun test         # Run tests
bun test --watch # Watch tests
```

## Hook Setup

The SessionEnd hook is configured in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun ~/.claude/hooks/session-title.ts"
          }
        ]
      }
    ]
  }
}
```

The hook script at `~/.claude/hooks/session-title.ts` imports and runs the titler.
