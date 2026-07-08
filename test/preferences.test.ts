import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDefaultSelectedAgentKeys,
  getCommonAgentKeys,
  getConfigDirectory,
  getPreferencesPath,
  mergeAgentKeys,
  readLastChosenAgentKeys,
  writeLastChosenAgentKeys,
} from "../src/preferences.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillman-prefs-"));
});

afterEach(async () => {
  delete process.env.SKILLMAN_CONFIG_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("preferences", () => {
  it("stores config under ~/.skillman/config.json by default", () => {
    delete process.env.SKILLMAN_CONFIG_DIR;

    expect(getConfigDirectory()).toBe(path.join(os.homedir(), ".skillman"));
    expect(getPreferencesPath()).toBe(path.join(os.homedir(), ".skillman", "config.json"));
  });

  it("supports an override config directory for tests and scripting", () => {
    process.env.SKILLMAN_CONFIG_DIR = tmpDir;

    expect(getConfigDirectory()).toBe(tmpDir);
    expect(getPreferencesPath()).toBe(path.join(tmpDir, "config.json"));
  });

  it("persists the last chosen known agents", async () => {
    await writeLastChosenAgentKeys(["cursor", "claude-code"], tmpDir);

    await expect(readLastChosenAgentKeys(tmpDir)).resolves.toEqual(["cursor", "claude-code"]);
    await expect(fs.readFile(path.join(tmpDir, "config.json"), "utf8")).resolves.toContain("lastChosenAgentKeys");
  });

  it("merges default selected agents with the last chosen additional agents", async () => {
    await writeLastChosenAgentKeys(["cursor", "roo", "trae"], tmpDir);

    await expect(getDefaultSelectedAgentKeys({ configDirectory: tmpDir })).resolves.toEqual([
      "agents",
      "codex",
      "trae",
      "trae-cn",
      "cursor",
      "roo",
    ]);
    await expect(getCommonAgentKeys({ configDirectory: tmpDir })).resolves.toEqual(["agents", "codex", "trae", "trae-cn", "cursor", "roo"]);
  });

  it("normalizes aliases, removes duplicates, and ignores unknown keys", () => {
    expect(mergeAgentKeys(["claude", "claude-code", "cursor-cli", "missing-agent"])).toEqual(["claude-code", "cursor"]);
  });

  it("filters saved project-only agents from global common targets", async () => {
    await writeLastChosenAgentKeys(["eve", "cursor"], tmpDir);

    await expect(getCommonAgentKeys({ configDirectory: tmpDir, global: true })).resolves.toEqual([
      "agents",
      "codex",
      "trae",
      "trae-cn",
      "cursor",
    ]);
  });

  it("ignores malformed config files", async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, "config.json"), "{nope");

    await expect(readLastChosenAgentKeys(tmpDir)).resolves.toEqual([]);
  });
});
