/**
 * Envoi d'emails via l'API REST de Resend et mémorisation de l'état précédent
 * dans Upstash Redis. Aucun SDK : `fetch` brut des deux côtés.
 *
 * Le stockage est optionnel. Sans Upstash configuré, la surveillance reste
 * fonctionnelle mais devient sans mémoire : chaque exécution qui trouve un
 * concours ouvert renotifie.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface EmailMessage {
  readonly subject: string;
  readonly html: string;
}

export interface EmailOutcome {
  readonly sent: boolean;
  /** Renseigné quand l'envoi est ignoré ou échoue. */
  readonly reason?: string;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

/** Envoie un email. Sans configuration Resend, l'envoi est ignoré, pas fatal. */
export async function sendEmail(message: EmailMessage): Promise<EmailOutcome> {
  const apiKey = readEnv("RESEND_API_KEY");
  const from = readEnv("MAIL_FROM");
  const to = readEnv("MAIL_TO");

  if (apiKey === undefined || from === undefined || to === undefined) {
    return {
      sent: false,
      reason: "RESEND_API_KEY, MAIL_FROM ou MAIL_TO manquant.",
    };
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: to.split(",").map((address: string): string => address.trim()),
      subject: message.subject,
      html: message.html,
    }),
  });

  if (!response.ok) {
    return {
      sent: false,
      reason: `Resend a répondu ${response.status} : ${await response.text()}`,
    };
  }

  return { sent: true };
}

interface UpstashConfig {
  readonly url: string;
  readonly token: string;
}

function upstashConfig(): UpstashConfig | undefined {
  const url = readEnv("UPSTASH_REDIS_REST_URL");
  const token = readEnv("UPSTASH_REDIS_REST_TOKEN");
  return url === undefined || token === undefined
    ? undefined
    : { url: url.replace(/\/+$/, ""), token };
}

async function upstash(
  config: UpstashConfig,
  path: readonly string[],
): Promise<unknown> {
  const segments = path.map((segment: string): string =>
    encodeURIComponent(segment),
  );
  const response = await fetch(`${config.url}/${segments.join("/")}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${config.token}` },
  });

  if (!response.ok) {
    throw new Error(`Upstash a répondu ${response.status}.`);
  }

  return response.json();
}

function resultField(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as { result?: unknown }).result;
  return typeof value === "string" ? value : undefined;
}

/** Lit l'état mémorisé. `undefined` si absent ou si Upstash n'est pas configuré. */
export async function readState(key: string): Promise<string | undefined> {
  const config = upstashConfig();
  if (config === undefined) return undefined;
  return resultField(await upstash(config, ["get", key]));
}

/** Mémorise l'état. Sans Upstash configuré, l'écriture est ignorée. */
export async function writeState(key: string, value: string): Promise<boolean> {
  const config = upstashConfig();
  if (config === undefined) return false;
  await upstash(config, ["set", key, value]);
  return true;
}

/** Indique si la mémorisation entre exécutions est active. */
export function stateStorageConfigured(): boolean {
  return upstashConfig() !== undefined;
}
