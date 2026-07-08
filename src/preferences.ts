import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { COMMON_AGENT_KEYS, getAgentTarget, type AgentKey } from "./agents.js";

export type SkillmanPreferences = {
  lastChosenAgentKeys?: AgentKey[];
};

const preferencesSchema = z.object({
  lastChosenAgentKeys: z.array(z.string().min(1)).optional(),
});

export function getConfigDirectory(): string {
  const configured = process.env.SKILLMAN_CONFIG_DIR?.trim();
  if (configured) {
    return path.resolve(expandHome(configured));
  }

  return path.join(os.homedir(), ".skillman");
}

export function getPreferencesPath(configDirectory = getConfigDirectory()): string {
  return path.join(configDirectory, "config.json");
}

export async function readPreferences(configDirectory = getConfigDirectory()): Promise<SkillmanPreferences> {
  const filePath = getPreferencesPath(configDirectory);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return {};
    }

    return {
      lastChosenAgentKeys: normalizeAgentKeys(parsed.data.lastChosenAgentKeys ?? []),
    };
  } catch (error) {
    if (isNotFoundError(error) || error instanceof SyntaxError) {
      return {};
    }

    throw error;
  }
}

export async function readLastChosenAgentKeys(configDirectory = getConfigDirectory()): Promise<AgentKey[]> {
  const preferences = await readPreferences(configDirectory);
  return preferences.lastChosenAgentKeys ?? [];
}

export async function writeLastChosenAgentKeys(agentKeys: readonly string[], configDirectory = getConfigDirectory()): Promise<void> {
  const normalizedAgentKeys = normalizeAgentKeys(agentKeys);
  await fs.mkdir(configDirectory, { recursive: true });
  await fs.writeFile(getPreferencesPath(configDirectory), `${JSON.stringify({ lastChosenAgentKeys: normalizedAgentKeys }, null, 2)}\n`);
}

export async function getDefaultSelectedAgentKeys(options: { configDirectory?: string; global?: boolean } = {}): Promise<AgentKey[]> {
  const lastChosenAgentKeys = await readLastChosenAgentKeys(options.configDirectory);
  const keys = mergeAgentKeys(COMMON_AGENT_KEYS, lastChosenAgentKeys);

  if (!options.global) {
    return keys;
  }

  return keys.filter((key) => Boolean(getAgentTarget(key)?.globalSkillDir));
}

export async function getCommonAgentKeys(options: { configDirectory?: string; global?: boolean } = {}): Promise<AgentKey[]> {
  return getDefaultSelectedAgentKeys(options);
}

export function mergeAgentKeys(...agentKeyGroups: readonly (readonly string[])[]): AgentKey[] {
  const result: AgentKey[] = [];
  const seen = new Set<string>();

  for (const group of agentKeyGroups) {
    for (const key of group) {
      const target = getAgentTarget(key);
      if (!target || seen.has(target.key)) {
        continue;
      }

      seen.add(target.key);
      result.push(target.key);
    }
  }

  return result;
}

function normalizeAgentKeys(agentKeys: readonly string[]): AgentKey[] {
  return mergeAgentKeys(agentKeys);
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
