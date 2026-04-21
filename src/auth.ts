import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import type { FizzyAuthConfig } from "./types";

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const DEFAULT_AGENT_DIR = join(homedir(), ".pi", "agent");
const DEFAULT_AUTH_FILE = "auth.json";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const getAuthPath = (): string => {
  const agentDir = process.env[AGENT_DIR_ENV] || DEFAULT_AGENT_DIR;
  return join(agentDir, DEFAULT_AUTH_FILE);
};

const normalizeConfig = (value: unknown): FizzyAuthConfig | null => {
  if (!isRecord(value)) {
    return null;
  }

  const type = value.type;
  const key = value.key;
  const baseUrl = value.baseUrl;

  if (type !== "api_key" || typeof key !== "string" || key.trim().length === 0) {
    return null;
  }

  return {
    type,
    key: key.trim(),
    baseUrl: typeof baseUrl === "string" && baseUrl.trim().length > 0
      ? baseUrl.trim().replace(/\/$/, "")
      : undefined,
  };
};

const getNestedFizzyConfig = (data: Record<string, unknown>): FizzyAuthConfig | null => {
  const direct = normalizeConfig(data.fizzy);
  if (direct) {
    return direct;
  }

  const extensions = data.extensions;
  if (!isRecord(extensions)) {
    return null;
  }

  return normalizeConfig(extensions.fizzy);
};

export const loadFizzyAuthConfig = async (): Promise<FizzyAuthConfig> => {
  const authPath = getAuthPath();
  let raw: string;

  try {
    raw = await readFile(authPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not read ${authPath}. Add a fizzy auth entry first. (${message})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse ${authPath} as JSON. (${message})`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Expected ${authPath} to contain a JSON object.`);
  }

  const config = getNestedFizzyConfig(parsed);
  if (!config) {
    throw new Error(
      `Missing auth.json entry for fizzy. Add a top-level \"fizzy\" object with { type: \"api_key\", key: \"...\" } or use extensions.fizzy.`,
    );
  }

  return config;
};

export const resolveConfiguredSecret = async (
  value: string,
  pi: ExtensionAPI,
): Promise<string> => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Configured secret is empty.");
  }

  if (trimmed.startsWith("!")) {
    const command = trimmed.slice(1).trim();
    if (!command) {
      throw new Error("Secret command is empty.");
    }

    const result = await pi.exec("bash", ["-lc", command]);
    if (result.code !== 0) {
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      throw new Error(
        `Secret command failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : "."}`,
      );
    }

    const resolved = result.stdout.trim();
    if (!resolved) {
      throw new Error("Secret command returned an empty value.");
    }

    return resolved;
  }

  const environmentValue = process.env[trimmed];
  if (environmentValue && environmentValue.trim().length > 0) {
    return environmentValue.trim();
  }

  return trimmed;
};
