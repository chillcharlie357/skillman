# skillman

English: [README-EN.md](./README-EN.md)

`skillman` 用软链接把本地 skill 目录安装到常见 agent 的 skills 目录中。

它适合类似 Vercel Skills 的工作流：同一份源 skill 可以同时提供给多个本地 agent 使用，不需要复制文件。

## 功能

- 使用目录软链接安装。
- 使用 `--force` 更新失效或指向错误位置的链接。
- agent 类型和路径参考 `npx skills`，支持 `claude-code`、`codex`、`cursor`、`opencode`、`trae`、`windsurf` 等。
- 内置目标默认以用户主目录为根，例如 `~/.agents/skills`、`~/.trae/skills`。
- 使用 `--root .` 安装到当前项目；使用 `-g, --global` 安装到各 agent 的官方全局 skills 目录。
- 支持自定义目标 skills 目录。
- 未指定目标参数时提供一个轻量交互式 TUI。
- TUI 会把上次在 `Choose from known agents` 中选择的 agent 记到 `~/.skillman/config.json`，并追加到 `Common agent directories`。
- 支持从包含多个 skill 的父目录递归安装。
- 提供 `status` 子命令查询链接是否 current、missing、stale 或 conflict。
- 提供 `remove` 子命令移除已安装的 skill 软链接。

## 安装

```bash
npm install -g @heleyang/skillman
```

从当前仓库本地安装：

```bash
pnpm install
pnpm run build
pnpm link --global
```

## 使用

把单个 skill 安装到 `~/.trae/skills`：

```bash
skillman install ./my-skill --agent trae
```

安装到所有已知 agent 的用户目录 skills：

```bash
skillman install ./my-skill --all
```

安装到各 agent 的官方全局 skills 目录：

```bash
skillman install ./my-skill --agent codex --agent claude-code --global
```

使用 `npx skills` 风格的通配 agent：

```bash
skillman install ./my-skill --agent '*'
```

安装到当前项目目录：

```bash
skillman install ./my-skill --agent agents --agent trae --root .
```

这会创建类似下面的链接：

```text
./.agents/skills/my-skill -> /absolute/path/to/my-skill
./.trae/skills/my-skill -> /absolute/path/to/my-skill
```

使用自定义的精确 skills 目录：

```bash
skillman install ./my-skill --target ~/.config/my-agent/skills
```

安装每个包含 `SKILL.md` 的子目录：

```bash
skillman install ./skills --recursive --all
```

预览将要执行的变更：

```bash
skillman install ./my-skill --all --dry-run
```

刷新已经存在但指向其他位置的链接：

```bash
skillman install ./my-skill --agent trae --force
```

使用 `install` 子命令且不传目标参数时进入 TUI。选择 `Common agent directories` 会直接使用默认目标 `agents`、`codex`、`trae`、`trae-cn`，并追加上次在 `Choose from known agents` 中选择过的目标。只有选择 `Choose from known agents` 时才会进入完整 agent 多选列表；这次选择会保存到 `~/.skillman/config.json`。

```bash
skillman install ./my-skill
```

查询当前链接状态：

```bash
skillman status ./my-skill --agent trae
```

输出 JSON 供脚本使用：

```bash
skillman status ./my-skill --agent '*' --json
```

移除已安装的 skill 软链接：

```bash
skillman remove ./my-skill --agent trae
```

如果现有链接指向其他位置，使用 `--force` 才会移除；非软链接文件或目录不会被删除。

兼容旧入口：`skillman ./my-skill --agent trae` 仍等价于 `skillman install ./my-skill --agent trae`。
根命令 `skillman` 等价于 `skillman --help`。

## 内置目标

| Agent | `--agent` | 默认目录 | 官方全局目录 |
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

还支持 `npx skills` supported agents 表中的更多 key，例如 `aider-desk`、`amp`、`antigravity`、`cline`、`crush`、`goose`、`kiro-cli`、`qwen-code`、`tabnine-cli`、`zed`、`zencoder` 等。使用 `skillman --help` 可查看当前完整 key 列表。

默认使用用户主目录作为内置目标根目录，因此 `--agent trae` 会写到 `~/.trae/skills`，`--agent agents` 会写到 `~/.agents/skills`。使用 `--root .` 可以安装到当前项目；使用 `-g, --global` 则安装到每个 agent 的官方全局 skills 目录。

## 文档维护

更新文档时，请保持 [README.md](./README.md) 和 [README-EN.md](./README-EN.md) 的章节结构、命令示例和目标表一致。
