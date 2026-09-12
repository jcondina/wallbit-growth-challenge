/**
 * Runtime configuration. Every value has a default that makes a clean clone
 * work with no .env at all (see .env.example).
 */

export interface WebhookConfig {
  secret: string;
  verifySignature: boolean;
}

export function webhookConfig(env: NodeJS.ProcessEnv = process.env): WebhookConfig {
  return {
    secret: env.WEBHOOK_SECRET ?? "whsec_sandbox_wallbit",
    // Only the literal string "false" disables verification; anything else keeps it on.
    verifySignature: env.WEBHOOK_VERIFY_SIGNATURE !== "false",
  };
}
