import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AGENT_TARGETS, type AgentKey, type AgentTarget, getAgentTarget } from "./agents.js";

export type InstallAction = "linked" | "updated" | "kept" | "skipped" | "created-dir";
export type RemoveAction = "removed" | "missing" | "skipped";
export type LinkStatus = "current" | "missing" | "stale" | "conflict";

export type SkillSource = {
  name: string;
  path: string;
};

export type CustomTarget = {
  key: "custom";
  label: string;
  description: string;
  relativeSkillDir: string;
};

export type ResolvedTarget = AgentTarget | CustomTarget;

export type InstallPlanItem = {
  skill: SkillSource;
  target: ResolvedTarget;
  scope: "root" | "global" | "custom";
  targetRoot: string;
  targetDir: string;
  linkPath: string;
};

export type InstallResult = InstallPlanItem & {
  action: InstallAction;
  message: string;
};

export type LinkStatusResult = InstallPlanItem & {
  status: LinkStatus;
  message: string;
  existingTarget?: string;
};

export type RemoveResult = InstallPlanItem & {
  action: RemoveAction;
  message: string;
  existingTarget?: string;
};

export type InstallOptions = {
  source: string;
  cwd?: string;
  root?: string;
  global?: boolean;
  agents?: AgentKey[];
  targets?: string[];
  name?: string;
  all?: boolean;
  force?: boolean;
  dryRun?: boolean;
  recursive?: boolean;
};

export type ResolveInstallOptions = Required<Pick<InstallOptions, "cwd" | "force" | "dryRun" | "recursive">> &
  Omit<InstallOptions, "cwd" | "force" | "dryRun" | "recursive"> & {
    global: boolean;
    root?: string;
  };

const SKILL_MARKERS = ["SKILL.md", "skill.md"];

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function normalizeOptions(options: InstallOptions): ResolveInstallOptions {
  const cwd = path.resolve(options.cwd ?? process.cwd());

  return {
    ...options,
    cwd,
    root: options.root ? path.resolve(cwd, expandHome(options.root)) : os.homedir(),
    global: options.global ?? false,
    force: options.force ?? false,
    dryRun: options.dryRun ?? false,
    recursive: options.recursive ?? false,
  };
}

export function expandHome(inputPath: string, homeDir = os.homedir()): string {
  if (inputPath === "~") {
    return homeDir;
  }

  if (inputPath.startsWith("~/")) {
    return path.join(homeDir, inputPath.slice(2));
  }

  return inputPath;
}

export function resolveTargetRoot(options: Pick<ResolveInstallOptions, "cwd" | "root">): string {
  return options.root ?? options.cwd;
}

export function resolveCustomTarget(targetPath: string): InstallPlanItem["target"] {
  return {
    key: "custom",
    label: targetPath,
    description: "Custom skill directory",
    relativeSkillDir: targetPath,
  };
}

export async function hasSkillMarker(directory: string): Promise<boolean> {
  const checks = await Promise.all(SKILL_MARKERS.map((marker) => pathExists(path.join(directory, marker))));
  return checks.some(Boolean);
}

export async function discoverSkills(source: string, options: Pick<ResolveInstallOptions, "cwd" | "recursive" | "name">): Promise<SkillSource[]> {
  const expandedSource = expandHome(source);
  const resolvedSource = path.isAbsolute(expandedSource) ? expandedSource : path.resolve(options.cwd, expandedSource);
  const sourceStat = await fs.stat(resolvedSource).catch((error: unknown) => {
    if (error instanceof Error) {
      throw new Error(`Source does not exist: ${resolvedSource}`);
    }

    throw error;
  });

  if (!sourceStat.isDirectory()) {
    throw new Error(`Source must be a directory: ${resolvedSource}`);
  }

  if (await hasSkillMarker(resolvedSource)) {
    return [
      {
        name: options.name ?? path.basename(resolvedSource),
        path: resolvedSource,
      },
    ];
  }

  if (!options.recursive) {
    return [
      {
        name: options.name ?? path.basename(resolvedSource),
        path: resolvedSource,
      },
    ];
  }

  const entries = await fs.readdir(resolvedSource, { withFileTypes: true });
  const skills: SkillSource[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const candidate = path.join(resolvedSource, entry.name);
    if (await hasSkillMarker(candidate)) {
      skills.push({
        name: entry.name,
        path: candidate,
      });
    }
  }

  if (skills.length === 0) {
    throw new Error(`No skills with SKILL.md found under: ${resolvedSource}`);
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveTargets(options: ResolveInstallOptions): InstallPlanItem["target"][] {
  const targets: InstallPlanItem["target"][] = [];

  if (options.all) {
    pushUniqueTargets(targets, filterTargetsForScope(AGENT_TARGETS, options.global));
  }

  for (const key of options.agents ?? []) {
    if (key === "*") {
      pushUniqueTargets(targets, filterTargetsForScope(AGENT_TARGETS, options.global));
      continue;
    }

    const target = getAgentTarget(key);
    if (!target) {
      throw new Error(`Unknown agent target "${key}". Available targets: ${AGENT_TARGETS.map((agent) => agent.key).join(", ")}`);
    }

    if (options.global && !target.globalSkillDir) {
      throw new Error(`Agent target "${target.key}" does not have a global skills directory. Use project scope instead.`);
    }

    pushUniqueTargets(targets, [target]);
  }

  for (const targetPath of options.targets ?? []) {
    const expandedTarget = expandHome(targetPath);
    const absoluteTarget = path.isAbsolute(expandedTarget) ? expandedTarget : path.resolve(options.cwd, expandedTarget);
    pushUniqueTargets(targets, [resolveCustomTarget(absoluteTarget)]);
  }

  return targets;
}

function filterTargetsForScope(targets: AgentTarget[], global: boolean): AgentTarget[] {
  if (!global) {
    return targets;
  }

  return targets.filter((target) => Boolean(target.globalSkillDir));
}

function pushUniqueTargets(targets: InstallPlanItem["target"][], nextTargets: InstallPlanItem["target"][]): void {
  for (const target of nextTargets) {
    if (!targets.some((item) => item.key === target.key)) {
      targets.push(target);
    }
  }
}

export async function createInstallPlan(options: InstallOptions): Promise<InstallPlanItem[]> {
  const normalized = normalizeOptions(options);
  const skills = await discoverSkills(normalized.source, normalized);
  const targets = resolveTargets(normalized);

  if (targets.length === 0) {
    throw new Error("No target selected. Use --agent, --target, --all, or run skillman without flags for the TUI.");
  }

  const targetRoot = resolveTargetRoot(normalized);
  const plan: InstallPlanItem[] = [];
  const plannedLinks = new Set<string>();

  for (const skill of skills) {
    for (const target of targets) {
      const targetDir = resolveTargetDir(target, normalized, targetRoot);
      const linkPath = path.join(targetDir, skill.name);

      if (plannedLinks.has(linkPath)) {
        continue;
      }

      plannedLinks.add(linkPath);

      plan.push({
        skill,
        target,
        scope: resolveScope(target, normalized),
        targetRoot,
        targetDir,
        linkPath,
      });
    }
  }

  return plan;
}

function resolveTargetDir(target: InstallPlanItem["target"], options: ResolveInstallOptions, targetRoot: string): string {
  if (isCustomTarget(target)) {
    return target.relativeSkillDir;
  }

  if (options.global) {
    if (!target.globalSkillDir) {
      throw new Error(`Agent target "${target.key}" does not have a global skills directory. Use project scope instead.`);
    }

    return target.globalSkillDir;
  }

  return path.isAbsolute(target.relativeSkillDir) ? target.relativeSkillDir : path.join(targetRoot, target.relativeSkillDir);
}

function resolveScope(target: InstallPlanItem["target"], options: ResolveInstallOptions): InstallPlanItem["scope"] {
  if (isCustomTarget(target)) {
    return "custom";
  }

  return options.global ? "global" : "root";
}

function isCustomTarget(target: ResolvedTarget): target is CustomTarget {
  return target.key === "custom";
}

export async function installSkills(options: InstallOptions): Promise<InstallResult[]> {
  const normalized = normalizeOptions(options);
  const plan = await createInstallPlan(normalized);
  const results: InstallResult[] = [];

  for (const item of plan) {
    results.push(await installPlanItem(item, normalized));
  }

  return results;
}

export async function inspectSkillLinks(options: InstallOptions): Promise<LinkStatusResult[]> {
  const plan = await createInstallPlan(options);
  const results: LinkStatusResult[] = [];

  for (const item of plan) {
    results.push(await inspectPlanItem(item));
  }

  return results;
}

export async function removeSkillLinks(options: InstallOptions): Promise<RemoveResult[]> {
  const normalized = normalizeOptions(options);
  const plan = await createInstallPlan(normalized);
  const results: RemoveResult[] = [];

  for (const item of plan) {
    results.push(await removePlanItem(item, normalized));
  }

  return results;
}

async function removePlanItem(item: InstallPlanItem, options: Pick<ResolveInstallOptions, "dryRun" | "force">): Promise<RemoveResult> {
  const existing = await fs.lstat(item.linkPath).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  });

  if (!existing) {
    return {
      ...item,
      action: "missing",
      message: `Missing ${item.linkPath}`,
    };
  }

  if (!existing.isSymbolicLink()) {
    return {
      ...item,
      action: "skipped",
      message: `Skipped ${item.linkPath}; a non-symlink entry exists.`,
    };
  }

  const currentTarget = await fs.readlink(item.linkPath);
  const resolvedCurrentTarget = path.resolve(path.dirname(item.linkPath), currentTarget);

  if (resolvedCurrentTarget !== item.skill.path && !options.force) {
    return {
      ...item,
      action: "skipped",
      existingTarget: resolvedCurrentTarget,
      message: `Skipped ${item.linkPath}; it points to ${resolvedCurrentTarget}. Use --force to remove it.`,
    };
  }

  if (!options.dryRun) {
    await fs.unlink(item.linkPath);
  }

  return {
    ...item,
    action: "removed",
    existingTarget: resolvedCurrentTarget,
    message: `${options.dryRun ? "Would remove" : "Removed"} ${item.linkPath} -> ${resolvedCurrentTarget}`,
  };
}

async function inspectPlanItem(item: InstallPlanItem): Promise<LinkStatusResult> {
  const existing = await fs.lstat(item.linkPath).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  });

  if (!existing) {
    return {
      ...item,
      status: "missing",
      message: `Missing ${item.linkPath} -> ${item.skill.path}`,
    };
  }

  if (!existing.isSymbolicLink()) {
    return {
      ...item,
      status: "conflict",
      message: `Conflict ${item.linkPath}; a non-symlink entry exists.`,
    };
  }

  const currentTarget = await fs.readlink(item.linkPath);
  const resolvedCurrentTarget = path.resolve(path.dirname(item.linkPath), currentTarget);

  if (resolvedCurrentTarget === item.skill.path) {
    return {
      ...item,
      status: "current",
      existingTarget: resolvedCurrentTarget,
      message: `Current ${item.linkPath} -> ${item.skill.path}`,
    };
  }

  return {
    ...item,
    status: "stale",
    existingTarget: resolvedCurrentTarget,
    message: `Stale ${item.linkPath}; points to ${resolvedCurrentTarget}, expected ${item.skill.path}`,
  };
}

async function installPlanItem(item: InstallPlanItem, options: Pick<ResolveInstallOptions, "dryRun" | "force">): Promise<InstallResult> {
  if (options.dryRun) {
    return {
      ...item,
      action: "linked",
      message: `Would link ${item.linkPath} -> ${item.skill.path}`,
    };
  }

  await fs.mkdir(item.targetDir, { recursive: true });

  const existing = await fs.lstat(item.linkPath).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  });

  if (!existing) {
    await createSymlink(item.skill.path, item.linkPath);
    return {
      ...item,
      action: "linked",
      message: `Linked ${item.linkPath} -> ${item.skill.path}`,
    };
  }

  if (existing.isSymbolicLink()) {
    const currentTarget = await fs.readlink(item.linkPath);
    const resolvedCurrentTarget = path.resolve(path.dirname(item.linkPath), currentTarget);

    if (resolvedCurrentTarget === item.skill.path) {
      return {
        ...item,
        action: "kept",
        message: `Already linked ${item.linkPath} -> ${item.skill.path}`,
      };
    }

    if (!options.force) {
      return {
        ...item,
        action: "skipped",
        message: `Skipped ${item.linkPath}; it points to ${resolvedCurrentTarget}. Use --force to update it.`,
      };
    }

    await fs.unlink(item.linkPath);
    await createSymlink(item.skill.path, item.linkPath);
    return {
      ...item,
      action: "updated",
      message: `Updated ${item.linkPath} -> ${item.skill.path}`,
    };
  }

  if (!options.force) {
    return {
      ...item,
      action: "skipped",
      message: `Skipped ${item.linkPath}; a non-symlink entry already exists. Use --force to replace it.`,
    };
  }

  if (existing.isDirectory()) {
    await fs.rm(item.linkPath, { recursive: true, force: true });
  } else {
    await fs.unlink(item.linkPath);
  }

  await createSymlink(item.skill.path, item.linkPath);
  return {
    ...item,
    action: "updated",
    message: `Replaced ${item.linkPath} -> ${item.skill.path}`,
  };
}

async function createSymlink(source: string, destination: string): Promise<void> {
  await fs.symlink(source, destination, "dir");
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
