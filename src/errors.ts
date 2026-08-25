import type { AutomationResult } from "./types.js";

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
}

export class FormStructureError extends Error {
  override readonly name = "FormStructureError";
}

export class SubmissionUnknownError extends Error {
  override readonly name = "SubmissionUnknownError";
}

export class ScoreExtractionError extends Error {
  override readonly name = "ScoreExtractionError";

  constructor(message: string, readonly result: AutomationResult) {
    super(message);
  }
}

export class ExternalServiceError extends Error {
  override readonly name = "ExternalServiceError";
}
