#!/usr/bin/env node
import { cancel, confirm, intro, isCancel, multiselect, note, outro, select, spinner, text } from "@clack/prompts";
import { Command, Option } from "commander";
import pc from "picocolors";
import { AGENT_TARGETS, formatAgentChoices, getAgentTarget, type AgentKey } from "./agents.js";
import { createInstallPlan, installSkills, normalizeOptions, type InstallOptions, type InstallResult } from "./installer.js";

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
  .argument("[source]", "skill directory, or a parent directory when --recursive is used")
  .addOption(new Option("-a, --agent <agent>", `built-in target: ${formatAgentChoices()}`).argParser(collect).default([]))
  .option("--all", "install into all built-in agent targets")
  .option("-g, --global", "install into each agent's global skills directory")
  .addOption(new Option("-t, --target <dir>", "custom skill directory, for example ~/.config/my-agent/skills").argParser(collect).default([]))
  .option("-r, --root <dir>", "root for built-in project-style targets; default is your home directory")
  .option("-n, --name <name>", "install the source directory under a custom skill name")
  .option("-f, --force", "replace stale symlinks or existing entries")
  .option("--dry-run", "print what would change without writing")
  .option("--recursive", "install each child directory that contains SKILL.md")
  .option("-y, --yes", "skip confirmation prompts")
  .action(async (source: string | undefined, options: CliOptions) => {
    try {
      const installOptions = await resolveOptions(source, options);
      const results = await runInstall(installOptions, options.yes ?? false);
      printResults(results, installOptions.dryRun ?? false);
    } catch (error) {
      if (error instanceof Error) {
        console.error(pc.red(error.message));
      } else {
        console.error(pc.red("Unknown error"));
      }

      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

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

  const mode = await select({
    message: "Where should skillman install it?",
    options: [
      { value: "built-in", label: "Known agent directories", hint: "~/.agents, ~/.trae, ~/.claude by default" },
      { value: "custom", label: "Custom skills directory", hint: "Provide an exact target folder" },
      { value: "all", label: "All known agent directories", hint: "Fast path" },
    ],
  });

  if (isCancel(mode)) {
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

  if (mode === "all") {
    next.all = true;
  }

  if (mode === "built-in") {
    const selectableTargets = options.global ? AGENT_TARGETS.filter((target) => target.globalSkillDir) : AGENT_TARGETS;

    const selectedAgents = await multiselect({
      message: "Choose agent targets",
      required: true,
      options: selectableTargets.map((target) => ({
        value: target.key,
        label: target.label,
        hint: options.global ? (target.globalSkillDir ?? "project-only") : target.relativeSkillDir,
      })),
    });

    if (isCancel(selectedAgents)) {
      cancel("Cancelled");
      process.exit(0);
    }

    next.agents = selectedAgents;
  }

  if (mode === "custom") {
    const target = await text({
      message: "Custom skills directory",
      placeholder: "~/.agents/skills",
      validate(value) {
        if (!value.trim()) {
          return "Enter a target directory.";
        }

        return undefined;
      },
    });

    if (isCancel(target)) {
      cancel("Cancelled");
      process.exit(0);
    }

    next.targets = [target];
  }

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

function printResults(results: InstallResult[], dryRun: boolean): void {
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
