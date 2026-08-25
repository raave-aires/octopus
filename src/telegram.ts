import { ExternalServiceError } from "./errors.js";
import type { CollectionResult, StoredFormLink } from "./types.js";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TelegramEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  entities?: TelegramEntity[];
  caption_entities?: TelegramEntity[];
  from?: { id: number };
  chat: { id: number; type: string };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export class TelegramClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;

  constructor(token: string, fetchImpl: FetchLike = fetch) {
    if (!token.trim()) throw new Error("Token do Telegram vazio.");
    this.#baseUrl = `https://api.telegram.org/bot${token}`;
    this.#fetch = fetchImpl;
  }

  async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
    const parameters = new URLSearchParams({
      limit: "100",
      timeout: "0",
      allowed_updates: JSON.stringify(["message"]),
    });
    if (offset !== undefined) parameters.set("offset", String(offset));
    return this.#call<TelegramUpdate[]>("getUpdates", parameters);
  }

  async acknowledgeThrough(updateId: number): Promise<void> {
    await this.getUpdates(updateId + 1);
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const parameters = new URLSearchParams({
      chat_id: chatId,
      text,
      link_preview_options: JSON.stringify({ is_disabled: true }),
    });
    await this.#call<TelegramMessage>("sendMessage", parameters);
  }

  async #call<T>(method: string, parameters: URLSearchParams): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: parameters,
      signal: AbortSignal.timeout(15_000),
    });

    let payload: TelegramResponse<T>;
    try {
      payload = (await response.json()) as TelegramResponse<T>;
    } catch {
      throw new ExternalServiceError(`Telegram respondeu HTTP ${response.status} sem JSON válido.`);
    }

    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new ExternalServiceError(
        `Telegram recusou ${method}: ${payload.description ?? `HTTP ${response.status}`}`,
      );
    }
    return payload.result;
  }
}

export function isAuthorizedMessage(
  message: TelegramMessage,
  allowedUserId: string,
): boolean {
  return (
    message.chat.type === "private" &&
    String(message.from?.id ?? "") === allowedUserId &&
    String(message.chat.id) === allowedUserId
  );
}

export function extractUrls(message: TelegramMessage): string[] {
  const body = message.text ?? message.caption ?? "";
  const entities = message.text ? message.entities : message.caption_entities;
  const found = new Set<string>();

  for (const entity of entities ?? []) {
    if (entity.type === "text_link" && entity.url) found.add(entity.url);
    if (entity.type === "url") found.add(body.slice(entity.offset, entity.offset + entity.length));
  }

  for (const match of body.matchAll(/https?:\/\/[^\s<>"']+/giu)) {
    found.add(match[0].replace(/[),.;\]}]+$/u, ""));
  }
  return [...found];
}

export function isGoogleFormsViewUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.hostname === "docs.google.com" &&
    /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[^/]+\/viewform\/?$/u.test(url.pathname)
  );
}

export async function normalizeFormUrl(
  rawUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  let candidate: URL;
  try {
    candidate = new URL(rawUrl);
  } catch {
    throw new Error("URL malformado.");
  }

  if (candidate.protocol !== "https:" || candidate.username || candidate.password || candidate.port) {
    throw new Error("O link deve usar HTTPS e não pode conter credenciais ou porta customizada.");
  }

  if (candidate.hostname === "forms.gle") {
    const response = await fetchImpl(candidate, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`O link forms.gle respondeu HTTP ${response.status}.`);
    candidate = new URL(response.url);
  }

  if (!isGoogleFormsViewUrl(candidate)) {
    throw new Error("O destino não é uma página viewform válida do Google Forms.");
  }

  candidate.hash = "";
  return candidate.toString();
}

export async function collectLatestFormLink(options: {
  updates: TelegramUpdate[];
  allowedUserId: string;
  fetchImpl?: FetchLike;
}): Promise<CollectionResult> {
  const { updates, allowedUserId, fetchImpl = fetch } = options;
  const maxUpdateId = updates.reduce<number | undefined>(
    (maximum, update) => (maximum === undefined ? update.update_id : Math.max(maximum, update.update_id)),
    undefined,
  );
  const notifications: string[] = [];
  const authorized = updates
    .filter((update) => update.message && isAuthorizedMessage(update.message, allowedUserId))
    .sort((left, right) => right.update_id - left.update_id);

  for (const update of authorized) {
    const message = update.message;
    if (!message) continue;
    const urls = extractUrls(message);
    if (urls.length === 0) continue;

    for (const rawUrl of urls) {
      try {
        const url = await normalizeFormUrl(rawUrl, fetchImpl);
        const storedLink: StoredFormLink = {
          version: 1,
          url,
          senderId: String(message.from?.id),
          chatId: String(message.chat.id),
          telegramUpdateId: update.update_id,
          receivedAt: new Date(message.date * 1_000).toISOString(),
        };
        return maxUpdateId === undefined
          ? { storedLink, notifications }
          : { maxUpdateId, storedLink, notifications };
      } catch (error) {
        notifications.push(
          `Recebi uma URL, mas ela não é um Google Form válido: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return maxUpdateId === undefined ? { notifications } : { maxUpdateId, notifications };
}
