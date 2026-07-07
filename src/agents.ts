import path from "node:path";
import os from "node:os";
import { z } from "zod";
import agentTargetConfig from "./agent-targets.json" with { type: "json" };

export type AgentKey = string;

export type AgentTarget = {
  key: AgentKey;
  aliases?: string[];
  label: string;
  description: string;
  relativeSkillDir: string;
  globalSkillDir?: string;
};

export const COMMON_AGENT_KEYS = ["agents", "codex", "trae", "trae-cn"] as const satisfies readonly AgentKey[];

const home = os.homedir();
const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config");
const codexHome = process.env.CODEX_HOME?.trim() || path.join(home, ".codex");
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude");
const autohandHome = process.env.AUTOHAND_HOME?.trim() || path.join(home, ".autohand");
const hermesHome = process.env.HERMES_HOME?.trim() || path.join(home, ".hermes");
const vibeHome = process.env.VIBE_HOME?.trim() || path.join(home, ".vibe");

const pathVariables: Record<string, string> = {
  home,
  configHome,
  codexHome,
  claudeHome,
  autohandHome,
  hermesHome,
  vibeHome,
};

const agentTargetSchema = z.object({
  key: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  label: z.string().min(1),
  description: z.string().min(1),
  relativeSkillDir: z.string().min(1),
  globalSkillDir: z.string().min(1).optional(),
});

const agentTargetsSchema = z.array(agentTargetSchema);

export const AGENT_TARGETS: AgentTarget[] = agentTargetsSchema.parse(agentTargetConfig).map((target) => ({
  ...target,
  relativeSkillDir: normalizeConfiguredPath(target.relativeSkillDir),
  globalSkillDir: target.globalSkillDir ? normalizeConfiguredPath(target.globalSkillDir) : undefined,
}));

function normalizeConfiguredPath(configuredPath: string): string {
  const expanded = configuredPath.replace(/\$\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name: string) => pathVariables[name] ?? match);
  return path.normalize(expanded);
}

export function getAgentTarget(key: string): AgentTarget | undefined {
  return AGENT_TARGETS.find((target) => target.key === key || target.aliases?.includes(key));
}

export function formatAgentChoices(): string {
  return AGENT_TARGETS.map((target) => target.key).join(", ");
}
