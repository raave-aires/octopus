import "dotenv/config";

import { ConfigurationError } from "./errors.js";
import type { ProfileConfig } from "./types.js";

const PROFILE_KEYS = [
  "fullName",
  "employeeId",
  "city",
  "employmentType",
  "supplier",
  "region",
  "manager",
  "workArea",
] as const satisfies readonly (keyof ProfileConfig)[];

export function loadProfile(raw = process.env.DSC_PROFILE_JSON): ProfileConfig {
  if (!raw?.trim()) {
    throw new ConfigurationError("DSC_PROFILE_JSON não foi configurado.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError("DSC_PROFILE_JSON não contém um JSON válido.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigurationError("DSC_PROFILE_JSON deve ser um objeto JSON.");
  }

  const record = parsed as Record<string, unknown>;
  const profile = {} as ProfileConfig;
  for (const key of PROFILE_KEYS) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new ConfigurationError(`DSC_PROFILE_JSON.${key} deve ser uma string não vazia.`);
    }
    profile[key] = value.trim();
  }
  return profile;
}

export function getGeminiApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.GOOGLE_API_KEY?.trim();
  if (!value) {
    throw new ConfigurationError("GOOGLE_API_KEY não foi configurado.");
  }
  return value;
}

export function getGeminiModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
}
