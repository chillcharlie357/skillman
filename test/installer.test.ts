import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMON_AGENT_KEYS } from "../src/agents.js";
import {
  createInstallPlan,
  inspectSkillLinks,
  installSkills,
  normalizeOptions,
  removeSkillLinks,
  resolveTargets,
} from "../src/installer.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillman-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("installSkills", () => {
  it("links one skill into a built-in target", async () => {
    const source = await makeSkill("demo");

    const results = await installSkills({
      source,
      cwd: tmpDir,
      root: tmpDir,
      agents: ["trae"],
    });

    const linkPath = path.join(tmpDir, ".trae", "skills", "demo");
    const stat = await fs.lstat(linkPath);

    expect(results).toHaveLength(1);
    expect(results[0]?.action).toBe("linked");
    expect(stat.isSymbolicLink()).toBe(true);
    expect(await fs.readlink(linkPath)).toBe(source);
  });

  it("keeps an existing link that already points to the source", async () => {
    const source = await makeSkill("demo");

    await installSkills({ source, cwd: tmpDir, root: tmpDir, agents: ["agents"] });
    const results = await installSkills({ source, cwd: tmpDir, root: tmpDir, agents: ["agents"] });

    expect(results[0]?.action).toBe("kept");
  });

  it("updates a stale symlink when force is enabled", async () => {
    const source = await makeSkill("demo");
    const oldSource = await makeSkill("old-demo");
    const targetDir = path.join(tmpDir, ".agents", "skills");
    const linkPath = path.join(targetDir, "demo");

    await fs.mkdir(targetDir, { recursive: true });
    await fs.symlink(oldSource, linkPath, "dir");

    const results = await installSkills({
      source,
      cwd: tmpDir,
      root: tmpDir,
      agents: ["agents"],
      force: true,
    });

    expect(results[0]?.action).toBe("updated");
    expect(await fs.readlink(linkPath)).toBe(source);
  });

  it("skips a stale symlink without force", async () => {
    const source = await makeSkill("demo");
    const oldSource = await makeSkill("old-demo");
    const targetDir = path.join(tmpDir, ".agents", "skills");
    const linkPath = path.join(targetDir, "demo");

    await fs.mkdir(targetDir, { recursive: true });
    await fs.symlink(oldSource, linkPath, "dir");

    const results = await installSkills({
      source,
      cwd: tmpDir,
      root: tmpDir,
      agents: ["agents"],
    });

    expect(results[0]?.action).toBe("skipped");
    expect(await fs.readlink(linkPath)).toBe(oldSource);
  });

  it("discovers child skills recursively", async () => {
    const parent = path.join(tmpDir, "skill-pack");
    await fs.mkdir(parent);
    await makeSkill("alpha", parent);
    await makeSkill("beta", parent);
    await fs.mkdir(path.join(parent, "not-a-skill"));

    const results = await installSkills({
      source: parent,
      cwd: tmpDir,
      root: tmpDir,
      agents: ["trae"],
      recursive: true,
    });

    expect(results.map((result) => result.skill.name)).toEqual(["alpha", "beta"]);
    await expect(fs.lstat(path.join(tmpDir, ".trae", "skills", "alpha"))).resolves.toBeDefined();
    await expect(fs.lstat(path.join(tmpDir, ".trae", "skills", "beta"))).resolves.toBeDefined();
  });
});

describe("inspectSkillLinks", () => {
  it("reports missing links before install and current links after install", async () => {
    const source = await makeSkill("demo");
    const options = {
      source,
      cwd: tmpDir,
      root: tmpDir,
      agents: ["trae"],
    };

    const before = await inspectSkillLinks(options);
    await installSkills(options);
    const after = await inspectSkillLinks(options);

    expect(before[0]?.status).toBe("missing");
    expect(after[0]?.status).toBe("current");
  });

  it("reports stale links that point to another source", async () => {
    const source = await makeSkill("demo");
    const oldSource = await makeSkill("old-demo");
    const targetDir = path.join(tmpDir, ".agents", "skills");
    const linkPath = path.join(targetDir, "demo");

    await fs.mkdir(targetDir, { recursive: true });
    await fs.symlink(oldSource, linkPath, "dir");

    const results = await inspectSkillLinks({
      source,
      cwd: tmpDir,
      root: tmpDir,
      agents: ["agents"],
    });

    expect(results[0]?.status).toBe("stale");
    expect(results[0]?.existingTarget).toBe(oldSource);
  });

  it("reports conflicts for non-symlink entries", async () => {
    const source = await makeSkill("demo");
    const targetDir = path.join(tmpDir, ".agents", "skills");
    const linkPath = path.join(targetDir, "demo");

    await fs.mkdir(targetDir, { recursive: true });
    await fs.mkdir(linkPath);

    const results = await inspectSkillLinks({
      source,
      cwd: tmpDir,
      root: tmpDir,
      agents: ["agents"],
    });

    expect(results[0]?.status).toBe("conflict");
  });
});

describe("removeSkillLinks", () => {
  it("removes a symlink that points to the expected source", async () => {
    const source = await makeSkill("demo");
    const options = {
      source,
      cwd: tmpDir,
      root: tmpDir,
      agents: ["trae"],
    };

    await installSkills(options);
    const results = await removeSkillLinks(options);

    expect(results[0]?.action).toBe("removed");
    await expect(fs.lstat(path.join(tmpDir, ".trae", "skills", "demo"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips stale symlinks without force", async () => {
    const source = await makeSkill("demo");
    const oldSource = await makeSkill("old-demo");
    const targetDir = path.join(tmpDir, ".agents", "skills");
    const linkPath = path.join(targetDir, "demo");

    await fs.mkdir(targetDir, { recursive: true });
    await fs.symlink(oldSource, linkPath, "dir");

    const results = await removeSkillLinks({
      source,
      cwd: tmpDir,
      root: tmpDir,
      agents: ["agents"],
    });

    expect(results[0]?.action).toBe("skipped");
    expect(await fs.readlink(linkPath)).toBe(oldSource);
  });

  it("removes stale symlinks with force", async () => {
    const source = await makeSkill("demo");
    const oldSource = await makeSkill("old-demo");
    const targetDir = path.join(tmpDir, ".agents", "skills");
    const linkPath = path.join(targetDir, "demo");

    await fs.mkdir(targetDir, { recursive: true });
    await fs.symlink(oldSource, linkPath, "dir");

    const results = await removeSkillLinks({
      source,
      cwd: tmpDir,
      root: tmpDir,
      agents: ["agents"],
      force: true,
    });

    expect(results[0]?.action).toBe("removed");
    await expect(fs.lstat(linkPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not remove non-symlink entries", async () => {
    const source = await makeSkill("demo");
    const targetDir = path.join(tmpDir, ".agents", "skills");
    const linkPath = path.join(targetDir, "demo");

    await fs.mkdir(linkPath, { recursive: true });

    const results = await removeSkillLinks({
      source,
      cwd: tmpDir,
      root: tmpDir,
      agents: ["agents"],
      force: true,
    });

    expect(results[0]?.action).toBe("skipped");
    await expect(fs.lstat(linkPath)).resolves.toBeDefined();
  });
});

describe("createInstallPlan", () => {
  it("uses root for built-in targets and exact path for custom targets", async () => {
    const source = await makeSkill("demo");
    const customTarget = path.join(tmpDir, "custom-skills");
    const root = path.join(tmpDir, "home");

    const plan = await createInstallPlan({
      source,
      cwd: tmpDir,
      root,
      agents: ["trae"],
      targets: [customTarget],
    });

    expect(plan.map((item) => item.linkPath)).toEqual([
      path.join(root, ".trae", "skills", "demo"),
      path.join(customTarget, "demo"),
    ]);
  });

  it("uses home-rooted built-in target paths by default", async () => {
    const source = await makeSkill("demo");

    const plan = await createInstallPlan({
      source,
      cwd: tmpDir,
      agents: ["codex", "claude-code", "cursor"],
    });

    expect(plan.map((item) => item.linkPath)).toEqual([
      path.join(os.homedir(), ".agents", "skills", "demo"),
      path.join(os.homedir(), ".claude", "skills", "demo"),
    ]);
    expect(plan.map((item) => item.scope)).toEqual(["root", "root"]);
  });

  it("uses --root for project-local built-in targets", async () => {
    const source = await makeSkill("demo");

    const plan = await createInstallPlan({
      source,
      cwd: tmpDir,
      root: ".",
      agents: ["agents", "trae"],
    });

    expect(plan.map((item) => item.linkPath)).toEqual([
      path.join(tmpDir, ".agents", "skills", "demo"),
      path.join(tmpDir, ".trae", "skills", "demo"),
    ]);
    expect(plan.map((item) => item.scope)).toEqual(["root", "root"]);
  });

  it("keeps the TUI common target set focused on default daily agents", async () => {
    const source = await makeSkill("demo");

    const plan = await createInstallPlan({
      source,
      cwd: tmpDir,
      root: tmpDir,
      agents: [...COMMON_AGENT_KEYS],
    });

    expect(COMMON_AGENT_KEYS).toEqual(["agents", "codex", "trae", "trae-cn"]);
    expect(plan.map((item) => item.target.key)).toEqual(["agents", "trae", "trae-cn"]);
    expect(plan.map((item) => item.linkPath)).toEqual([
      path.join(tmpDir, ".agents", "skills", "demo"),
      path.join(tmpDir, ".trae", "skills", "demo"),
      path.join(tmpDir, ".trae-cn", "skills", "demo"),
    ]);
  });

  it("uses .trae-cn for the Trae CN project target", async () => {
    const source = await makeSkill("demo");

    const plan = await createInstallPlan({
      source,
      cwd: tmpDir,
      root: ".",
      agents: ["trae-cn"],
    });

    expect(plan.map((item) => item.linkPath)).toEqual([path.join(tmpDir, ".trae-cn", "skills", "demo")]);
  });

  it("expands the TUI common target set to each official global directory", async () => {
    const source = await makeSkill("demo");

    const plan = await createInstallPlan({
      source,
      cwd: tmpDir,
      agents: [...COMMON_AGENT_KEYS],
      global: true,
    });

    const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");

    expect(plan.map((item) => item.target.key)).toEqual(["agents", "codex", "trae", "trae-cn"]);
    expect(plan.map((item) => item.linkPath)).toEqual([
      path.join(os.homedir(), ".agents", "skills", "demo"),
      path.join(codexHome, "skills", "demo"),
      path.join(os.homedir(), ".trae", "skills", "demo"),
      path.join(os.homedir(), ".trae-cn", "skills", "demo"),
    ]);
  });

  it("uses each agent global path with global scope", async () => {
    const source = await makeSkill("demo");

    const plan = await createInstallPlan({
      source,
      cwd: tmpDir,
      agents: ["codex", "trae-cn", "opencode"],
      global: true,
    });

    const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");

    expect(plan.map((item) => item.linkPath)).toEqual([
      path.join(codexHome, "skills", "demo"),
      path.join(os.homedir(), ".trae-cn", "skills", "demo"),
      path.join(os.homedir(), ".config", "opencode", "skills", "demo"),
    ]);
    expect(plan.every((item) => item.scope === "global")).toBe(true);
  });

  it("expands wildcard agents and deduplicates identical target paths", async () => {
    const source = await makeSkill("demo");

    const plan = await createInstallPlan({
      source,
      cwd: tmpDir,
      agents: ["*"],
      root: tmpDir,
    });

    const linkPaths = plan.map((item) => item.linkPath);
    expect(linkPaths.length).toBe(new Set(linkPaths).size);
    expect(linkPaths).toContain(path.join(tmpDir, ".agents", "skills", "demo"));
    expect(linkPaths).toContain(path.join(tmpDir, ".trae", "skills", "demo"));
    expect(linkPaths).toContain(path.join(tmpDir, ".claude", "skills", "demo"));
    expect(linkPaths).toContain(path.join(tmpDir, ".roo", "skills", "demo"));
    expect(linkPaths).toContain(path.join(tmpDir, ".windsurf", "skills", "demo"));
  });

  it("supports common agent aliases", async () => {
    const targets = resolveTargets(
      normalizeOptions({
        source: "demo",
        cwd: tmpDir,
        agents: ["claude", "cursor-cli", "gemini"],
      }),
    );

    expect(targets.map((target) => target.key)).toEqual(["claude-code", "cursor", "gemini-cli"]);
  });

  it("rejects project-only agents in global scope", async () => {
    const source = await makeSkill("demo");

    await expect(
      createInstallPlan({
        source,
        cwd: tmpDir,
        agents: ["eve"],
        global: true,
      }),
    ).rejects.toThrow('Agent target "eve" does not have a global skills directory');
  });
});

describe("normalizeOptions", () => {
  it("defaults built-in target roots to the user home directory", () => {
    const options = normalizeOptions({
      source: "demo",
      cwd: tmpDir,
      agents: ["trae"],
    });

    expect(options.root).toBe(os.homedir());
    expect(options.global).toBe(false);
  });
});

async function makeSkill(name: string, parent = tmpDir): Promise<string> {
  const directory = path.join(parent, name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "SKILL.md"), `# ${name}\n`);
  return directory;
}
