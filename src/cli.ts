#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cancel, confirm, groupMultiselect, intro, isCancel, note, outro, spinner, text } from "@clack/prompts";
import { Command, Option } from "commander";
import pc from "picocolors";
import { AGENT_TARGETS, formatAgentChoices, getAgentTarget, type AgentKey, type AgentTarget } from "./agents.js";
import {
  createInstallPlan,
  inspectSkillLinks,
  installSkills,
  removeSkillLinks,
  type InstallOptions,
  type InstallResult,
  type LinkStatusResult,
  type RemoveResult,
} from "./installer.js";
import { getDefaultSelectedAgentKeys, mergeAgentKeys, writeLastChosenAgentKeys } from "./preferences.js";

type CliOptions = {
  agent?: string[];
  all?: boolean;
  global?: boolean;
  target?: string[];
  root?: string;
  name?: string;
  force?: boolean;
  dryRun?: boolean;
  recursive?: boolean;
  yes?: boolean;
};

const program = new Command()
  .name("skillman")
  .description("Install local skill directories into agent skill folders with symlinks.")
  .version(getPackageVersion(), "-v, --version", "display version number")
  .showHelpAfterError()
  .action(() => {
    program.help();
  });

program
  .command("install")
  .description("Install skill directories into agent skills directories")
  .argument("[source]", "skill directory, or a parent directory when --recursive is used")
  .addOption(agentOption())
  .option("--all", "install into all built-in agent targets")
  .option("-g, --global", "install into each agent's global skills directory")
  .addOption(targetOption())
  .option("-r, --root <dir>", "root for built-in project-style targets; default is your home directory")
  .option("-n, --name <name>", "install the source directory under a custom skill name")
  .option("-f, --force", "replace stale symlinks or existing entries")
  .option("--dry-run", "print what would change without writing")
  .option("--recursive", "install each child directory that contains SKILL.md")
  .option("-y, --yes", "skip confirmation prompts")
  .action(async (source: string | undefined, options: CliOptions) => {
    await handleCommand(async () => {
      const installOptions = await resolveOptions(source, options);
      const results = await runInstall(installOptions, options.yes ?? false);
      printInstallResults(results, installOptions.dryRun ?? false);
    });
  });

program
  .command("status")
  .description("Show whether expected skill symlinks are current, missing, stale, or conflicting")
  .argument("<source>", "skill directory, or a parent directory when --recursive is used")
  .addOption(agentOption())
  .option("--all", "check all built-in agent targets")
  .option("-g, --global", "check each agent's global skills directory")
  .addOption(targetOption())
  .option("-r, --root <dir>", "root for built-in project-style targets; default is your home directory")
  .option("-n, --name <name>", "expected installed skill name")
  .option("--recursive", "check each child directory that contains SKILL.md")
  .option("--json", "output machine-readable JSON")
  .action(async (source: string, options: CliOptions & { json?: boolean }) => {
    await handleCommand(async () => {
      const statusOptions = normalizeCliOptions(source, options);
      const results = await inspectSkillLinks(statusOptions);
      printStatusResults(results, options.json ?? false);

      if (results.some((result) => result.status !== "current")) {
        process.exitCode = 1;
      }
    });
  });

program
  .command("remove")
  .alias("rm")
  .description("Remove expected skill symlinks from agent skills directories")
  .argument("<source>", "skill directory, or a parent directory when --recursive is used")
  .addOption(agentOption())
  .option("--all", "remove from all built-in agent targets")
  .option("-g, --global", "remove from each agent's global skills directory")
  .addOption(targetOption())
  .option("-r, --root <dir>", "root for built-in project-style targets; default is your home directory")
  .option("-n, --name <name>", "installed skill name to remove")
  .option("-f, --force", "remove stale symlinks that point somewhere else")
  .option("--dry-run", "print what would be removed without writing")
  .option("--recursive", "remove each child directory that contains SKILL.md")
  .option("-y, --yes", "skip confirmation prompts")
  .action(async (source: string, options: CliOptions) => {
    await handleCommand(async () => {
      const removeOptions = normalizeCliOptions(source, options);
      const plan = await createInstallPlan(removeOptions);

      note(
        plan.map((item) => `${pc.cyan(item.target.label)} ${item.linkPath} ${pc.dim("x")} ${item.skill.path}`).join("\n"),
        removeOptions.dryRun ? "Dry run remove plan" : "Remove plan",
      );

      if (!options.yes && !removeOptions.dryRun) {
        const confirmed = await confirm({
          message: "Remove these symlinks?",
          initialValue: true,
        });

        if (isCancel(confirmed) || !confirmed) {
          cancel("Cancelled");
          process.exit(0);
        }
      }

      const s = spinner();
      s.start(removeOptions.dryRun ? "Checking links" : "Removing links");
      const results = await removeSkillLinks(removeOptions);
      s.stop(removeOptions.dryRun ? "Plan checked" : "Remove complete");
      printRemoveResults(results, removeOptions.dryRun ?? false);
    });
  });

program.parseAsync(rewriteLegacyArgv(process.argv));

function rewriteLegacyArgv(argv: string[]): string[] {
  const commandNames = new Set(["install", "status", "remove", "rm", "help"]);
  const firstArg = argv[2];

  if (!firstArg) {
    return argv;
  }

  if (commandNames.has(firstArg) || firstArg === "--help" || firstArg === "-h" || firstArg === "--version" || firstArg === "-v") {
    return argv;
  }

  return [...argv.slice(0, 2), "install", ...argv.slice(2)];
}

function agentOption(): Option {
  return new Option("-a, --agent <agent>", `built-in target: ${formatAgentChoices()}`).argParser(collect).default([]);
}

function targetOption(): Option {
  return new Option("-t, --target <dir>", "custom skill directory, for example ~/.config/my-agent/skills").argParser(collect).default([]);
}

function getPackageVersion(): string {
  const startDirectory = path.dirname(fileURLToPath(import.meta.url));

  for (const candidate of [path.join(startDirectory, "..", "package.json"), path.join(startDirectory, "..", "..", "package.json")]) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const packageJson = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: unknown };
    if (typeof packageJson.version === "string") {
      return packageJson.version;
    }
  }

  return "0.0.0";
}

async function handleCommand(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) {
      console.error(pc.red(error.message));
    } else {
      console.error(pc.red("Unknown error"));
    }

    process.exitCode = 1;
  }
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

async function resolveOptions(source: string | undefined, options: CliOptions): Promise<InstallOptions> {
  const hasExplicitTargets = Boolean(options.all || options.agent?.length || options.target?.length);

  if (source && hasExplicitTargets) {
    return normalizeCliOptions(source, options);
  }

  return runTui(source, options);
}

async function runTui(source: string | undefined, options: CliOptions): Promise<InstallOptions> {
  intro(pc.bold("skillman"));

  const selectedSource =
    source ??
    (await text({
      message: "Skill source directory",
      placeholder: "./my-skill",
      validate(value) {
        if (!value.trim()) {
          return "Enter a source directory.";
        }

        return undefined;
      },
    }));

  if (isCancel(selectedSource)) {
    cancel("Cancelled");
    process.exit(0);
  }

  const next: InstallOptions = {
    source: selectedSource,
    name: options.name,
    root: options.root,
    global: options.global,
    force: options.force,
    dryRun: options.dryRun,
    recursive: options.recursive,
  };

  const selectedAgents = await selectTuiAgents(options.global ?? false);
  next.agents = selectedAgents;

  if (next.force === undefined) {
    const shouldForce = await confirm({
      message: "Update existing links if they point somewhere else?",
      initialValue: true,
    });

    if (isCancel(shouldForce)) {
      cancel("Cancelled");
      process.exit(0);
    }

    next.force = shouldForce;
  }

  return next;
}

async function selectTuiAgents(global: boolean): Promise<AgentKey[]> {
  const alwaysIncludedAgentKeys = getAlwaysIncludedAgentKeys(global);
  const alwaysIncludedTargetDirs = new Set(
    alwaysIncludedAgentKeys
      .map((key) => getAgentTarget(key))
      .filter((target): target is NonNullable<ReturnType<typeof getAgentTarget>> => Boolean(target))
      .map((target) => getTargetSkillDir(target, global)),
  );
  const coveredTargets = getSelectableAgentTargets(global).filter((target) => alwaysIncludedTargetDirs.has(getTargetSkillDir(target, global)));
  const defaultSelectedAgentKeys = await getDefaultSelectedAgentKeys({ global });
  const additionalTargets = getSelectableAgentTargets(global).filter((target) => !alwaysIncludedTargetDirs.has(getTargetSkillDir(target, global)));
  const additionalTargetKeys = new Set(additionalTargets.map((target) => target.key));
  const initialAdditionalAgentKeys = defaultSelectedAgentKeys.filter((key) => additionalTargetKeys.has(key));
  const additionalOptions = sortTargetsBySelection(additionalTargets, initialAdditionalAgentKeys).map((target) => ({
    value: target.key,
    label: target.label,
    hint: formatTargetHint(target, global),
  }));
  const alwaysIncludedOptions = alwaysIncludedAgentKeys
    .map((key) => getAgentTarget(key))
    .filter((target): target is NonNullable<ReturnType<typeof getAgentTarget>> => Boolean(target))
    .map((target) => ({
      value: target.key,
      label: target.label,
      hint: formatAlwaysIncludedHint(target, alwaysIncludedAgentKeys, coveredTargets, global),
    }));

  const selectedAgentKeys = await groupMultiselect({
    message: "Which agents do you want to install to?",
    options: {
      "Always included": alwaysIncludedOptions,
      "Additional agents": additionalOptions,
    },
    initialValues: mergeAgentKeys(alwaysIncludedAgentKeys, initialAdditionalAgentKeys),
    cursorAt: initialAdditionalAgentKeys[0] ?? additionalOptions[0]?.value,
    required: false,
    selectableGroups: false,
  });

  if (isCancel(selectedAgentKeys)) {
    cancel("Cancelled");
    process.exit(0);
  }

  const selectedAdditionalAgentKeys = selectedAgentKeys.filter((key) => additionalTargetKeys.has(key));
  await writeLastChosenAgentKeys(selectedAdditionalAgentKeys);
  return mergeAgentKeys(alwaysIncludedAgentKeys, selectedAdditionalAgentKeys);
}

function getAlwaysIncludedAgentKeys(global: boolean): AgentKey[] {
  const keys = ["agents"] satisfies AgentKey[];
  if (!global) {
    return keys;
  }

  return keys.filter((key) => Boolean(getAgentTarget(key)?.globalSkillDir));
}

function getSelectableAgentTargets(global: boolean) {
  return global ? AGENT_TARGETS.filter((target) => target.globalSkillDir) : AGENT_TARGETS;
}

function formatTargetHint(target: NonNullable<ReturnType<typeof getAgentTarget>>, global: boolean): string {
  return getTargetSkillDir(target, global);
}

function getTargetSkillDir(target: NonNullable<ReturnType<typeof getAgentTarget>>, global: boolean): string {
  return global ? (target.globalSkillDir ?? target.relativeSkillDir) : target.relativeSkillDir;
}

function formatAlwaysIncludedHint(
  target: NonNullable<ReturnType<typeof getAgentTarget>>,
  alwaysIncludedAgentKeys: readonly AgentKey[],
  coveredTargets: readonly AgentTarget[],
  global: boolean,
): string {
  const coveredCount = countCoveredAgents(alwaysIncludedAgentKeys, coveredTargets);
  const coveredSuffix = coveredCount > 0 ? `; covers ${coveredCount} agents` : "";

  return `${formatTargetHint(target, global)}; always included${coveredSuffix}`;
}

function countCoveredAgents(alwaysIncludedAgentKeys: readonly AgentKey[], coveredTargets: readonly AgentTarget[]): number {
  const alwaysIncludedAgentKeySet = new Set(alwaysIncludedAgentKeys);
  return coveredTargets.filter((target) => !alwaysIncludedAgentKeySet.has(target.key)).length;
}

function sortTargetsBySelection(targets: readonly AgentTarget[], selectedAgentKeys: readonly AgentKey[]): AgentTarget[] {
  const selectedOrder = new Map(selectedAgentKeys.map((key, index) => [key, index]));

  return [...targets].sort((left, right) => {
    const leftOrder = selectedOrder.get(left.key);
    const rightOrder = selectedOrder.get(right.key);

    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder;
    }

    if (leftOrder !== undefined) {
      return -1;
    }

    if (rightOrder !== undefined) {
      return 1;
    }

    return left.label.localeCompare(right.label);
  });
}

function normalizeCliOptions(source: string, options: CliOptions): InstallOptions {
  const agents = validateAgents(options.agent ?? []);

  return {
    source,
    agents,
    all: options.all,
    global: options.global,
    targets: options.target,
    root: options.root,
    name: options.name,
    force: options.force,
    dryRun: options.dryRun,
    recursive: options.recursive,
  };
}

function validateAgents(agents: string[]): AgentKey[] {
  const invalidAgents = agents.filter((agent) => agent !== "*" && !getAgentTarget(agent));

  if (invalidAgents.length > 0) {
    throw new Error(`Invalid --agent value: ${invalidAgents.join(", ")}. Available targets: ${formatAgentChoices()}`);
  }

  return agents;
}

async function runInstall(options: InstallOptions, assumeYes: boolean): Promise<InstallResult[]> {
  const plan = await createInstallPlan(options);

  note(
    plan.map((item) => `${pc.cyan(item.target.label)} ${item.linkPath} ${pc.dim("->")} ${item.skill.path}`).join("\n"),
    options.dryRun ? "Dry run plan" : "Install plan",
  );

  if (!assumeYes && !options.dryRun) {
    const confirmed = await confirm({
      message: "Apply this plan?",
      initialValue: true,
    });

    if (isCancel(confirmed) || !confirmed) {
      cancel("Cancelled");
      process.exit(0);
    }
  }

  const s = spinner();
  s.start(options.dryRun ? "Checking links" : "Installing skills");
  const results = await installSkills(options);
  s.stop(options.dryRun ? "Plan checked" : "Install complete");

  return results;
}

function printInstallResults(results: InstallResult[], dryRun: boolean): void {
  for (const result of results) {
    const icon = formatAction(result.action);
    console.log(`${icon} ${result.message}`);
  }

  const skipped = results.filter((result) => result.action === "skipped").length;
  const changed = results.filter((result) => result.action === "linked" || result.action === "updated").length;
  const kept = results.filter((result) => result.action === "kept").length;

  outro(
    dryRun
      ? `${results.length} planned link${results.length === 1 ? "" : "s"}.`
      : `${changed} changed, ${kept} already current, ${skipped} skipped.`,
  );
}

function printStatusResults(results: LinkStatusResult[], json: boolean): void {
  if (json) {
    console.log(
      JSON.stringify(
        results.map((result) => ({
          skill: result.skill.name,
          target: result.target.key,
          scope: result.scope,
          status: result.status,
          linkPath: result.linkPath,
          expectedTarget: result.skill.path,
          existingTarget: result.existingTarget,
        })),
        null,
        2,
      ),
    );
    return;
  }

  for (const result of results) {
    const icon = formatStatus(result.status);
    console.log(`${icon} ${result.message}`);
  }

  const current = results.filter((result) => result.status === "current").length;
  const missing = results.filter((result) => result.status === "missing").length;
  const stale = results.filter((result) => result.status === "stale").length;
  const conflicts = results.filter((result) => result.status === "conflict").length;

  outro(`${current} current, ${missing} missing, ${stale} stale, ${conflicts} conflict${conflicts === 1 ? "" : "s"}.`);
}

function printRemoveResults(results: RemoveResult[], dryRun: boolean): void {
  for (const result of results) {
    const icon = formatRemoveAction(result.action);
    console.log(`${icon} ${result.message}`);
  }

  const removed = results.filter((result) => result.action === "removed").length;
  const missing = results.filter((result) => result.action === "missing").length;
  const skipped = results.filter((result) => result.action === "skipped").length;

  outro(
    dryRun
      ? `${removed} removable, ${missing} missing, ${skipped} skipped.`
      : `${removed} removed, ${missing} missing, ${skipped} skipped.`,
  );
}

function formatAction(action: InstallResult["action"]): string {
  switch (action) {
    case "linked":
      return pc.green("+");
    case "updated":
      return pc.yellow("~");
    case "kept":
      return pc.dim("=");
    case "skipped":
      return pc.red("!");
    case "created-dir":
      return pc.blue("*");
  }
}

function formatStatus(status: LinkStatusResult["status"]): string {
  switch (status) {
    case "current":
      return pc.green("=");
    case "missing":
      return pc.yellow("?");
    case "stale":
      return pc.yellow("~");
    case "conflict":
      return pc.red("!");
  }
}

function formatRemoveAction(action: RemoveResult["action"]): string {
  switch (action) {
    case "removed":
      return pc.green("-");
    case "missing":
      return pc.dim("?");
    case "skipped":
      return pc.red("!");
  }
}
