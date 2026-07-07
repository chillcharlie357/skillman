# skillman

中文: [README.md](./README.md)

`skillman` installs local skill directories into common agent skills directories with symlinks.

It is meant for the Vercel Skills-style workflow where one source skill can be made available to several local agents without copying files.

## Features

- Installs with directory symlinks.
- Updates stale or incorrectly pointed links with `--force`.
- Uses agent names and paths aligned with `npx skills`, including `claude-code`, `codex`, `cursor`, `opencode`, `trae`, and `windsurf`.
- Uses the user home directory as the default root for built-in targets, such as `~/.agents/skills` and `~/.trae/skills`.
- Use `--root .` for the current project; use `-g, --global` for each agent's official global skills directory.
- Supports custom target skills directories.
- Provides a small interactive TUI when target flags are omitted.
- Supports recursive installation from a parent directory containing multiple skills.

## Install

```bash
npm install -g @chillcharlie/skillman
```

Install locally from this repo:

```bash
pnpm install
pnpm run build
pnpm link --global
```

## Usage

Install one skill into `~/.trae/skills`:

```bash
skillman ./my-skill --agent trae
```

Install into all known user-directory skills targets:

```bash
skillman ./my-skill --all
```

Install into each agent's official global skills directory:

```bash
skillman ./my-skill --agent codex --agent claude-code --global
```

Use the `npx skills`-style wildcard agent:

```bash
skillman ./my-skill --agent '*'
```

Install into the current project:

```bash
skillman ./my-skill --agent agents --agent trae --root .
```

That creates links like:

```text
./.agents/skills/my-skill -> /absolute/path/to/my-skill
./.trae/skills/my-skill -> /absolute/path/to/my-skill
```

Use a custom exact skills directory:

```bash
skillman ./my-skill --target ~/.config/my-agent/skills
```

Install every child directory that contains `SKILL.md`:

```bash
skillman ./skills --recursive --all
```

Preview changes:

```bash
skillman ./my-skill --all --dry-run
```

Refresh an existing link that points somewhere else:

```bash
skillman ./my-skill --agent trae --force
```

Run without a target to use the TUI:

```bash
skillman ./my-skill
```

## Built-In Targets

| Agent | `--agent` | Default Directory | Official Global Directory |
| --- | --- | --- | --- |
| Universal | `agents`, `universal` | `~/.agents/skills` | `~/.agents/skills` (`agents`), `~/.config/agents/skills` (`universal`) |
| Claude Code | `claude-code` (`claude`) | `~/.claude/skills` | `~/.claude/skills` |
| Codex | `codex` | `~/.agents/skills` | `~/.codex/skills` |
| Cursor | `cursor` (`cursor-cli`) | `~/.agents/skills` | `~/.cursor/skills` |
| Gemini CLI | `gemini-cli` (`gemini`) | `~/.agents/skills` | `~/.gemini/skills` |
| OpenCode | `opencode` | `~/.agents/skills` | `~/.config/opencode/skills` |
| Roo Code | `roo` | `~/.roo/skills` | `~/.roo/skills` |
| Trae | `trae`, `trae-cn` | `~/.trae/skills` | `~/.trae/skills`, `~/.trae-cn/skills` |
| Windsurf | `windsurf` | `~/.windsurf/skills` | `~/.codeium/windsurf/skills` |

It also supports more keys from the `npx skills` supported agents table, such as `aider-desk`, `amp`, `antigravity`, `cline`, `crush`, `goose`, `kiro-cli`, `qwen-code`, `tabnine-cli`, `zed`, and `zencoder`. Run `skillman --help` to see the current full key list.

Built-in targets use the user home directory as their default root, so `--agent trae` writes to `~/.trae/skills` and `--agent agents` writes to `~/.agents/skills`. Use `--root .` to install into the current project; use `-g, --global` to install into each agent's official global skills directory.

## Documentation Maintenance

When updating docs, keep [README.md](./README.md) and [README-EN.md](./README-EN.md) aligned in section structure, command examples, and target tables.
