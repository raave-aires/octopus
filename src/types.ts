export interface ProfileConfig {
  fullName: string;
  employeeId: string;
  city: string;
  employmentType: string;
  supplier: string;
  region: string;
  manager: string;
  workArea: string;
}

export interface StoredFormLink {
  version: 1;
  url: string;
  senderId: string;
  chatId: string;
  telegramUpdateId: number;
  receivedAt: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
}

export interface QuizDecision {
  questionId: string;
  optionIndex: number;
  rationale: string;
}

export type SubmissionStatus = "dry-run" | "success" | "unknown" | "failure";

export interface QuizScore {
  earned: number;
  total: number;
  label: string;
}

export interface SubmissionRecord {
  version: 1;
  status: SubmissionStatus;
  weekKey: string;
  urlHash: string;
  theme: string;
  submittedAt: string;
  questionCount: number;
  confirmationText?: string;
  score?: QuizScore;
}

export interface AutomationResult {
  record: SubmissionRecord;
  questions: QuizQuestion[];
  decisions: QuizDecision[];
}

export interface CollectionResult {
  maxUpdateId?: number;
  storedLink?: StoredFormLink;
  notifications: string[];
}

export interface GitHubArtifact {
  id: number;
  name: string;
  expired: boolean;
  created_at: string;
  expires_at: string;
  workflow_run?: {
    id: number;
  };
}
