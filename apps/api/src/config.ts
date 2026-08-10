import { fileURLToPath } from "node:url";

export type AppConfig = {
  host: string;
  port: number;
  webOrigin: string;
  storageDriver: "memory" | "postgres";
  databaseUrl?: string;
  registryPath: string;
  executionDriver: "simulated" | "queue";
  redisUrl: string;
  callbackToken?: string;
  openAiApiKey?: string;
  openAiModel: string;
  artifactPath: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const storageDriver = env.STORAGE_DRIVER === "postgres" ? "postgres" : "memory";
  const executionDriver = env.EXECUTION_DRIVER === "queue" ? "queue" : "simulated";
  const databaseUrl = env.DATABASE_URL || undefined;
  const openAiApiKey = env.OPENAI_API_KEY || undefined;

  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 4100),
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:3000",
    storageDriver,
    ...(databaseUrl ? { databaseUrl } : {}),
    registryPath: env.AGENT_REGISTRY_PATH ?? fileURLToPath(new URL("../../../agents", import.meta.url)),
    executionDriver,
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    ...(env.AGENT_CALLBACK_TOKEN ? { callbackToken: env.AGENT_CALLBACK_TOKEN } : {}),
    ...(openAiApiKey ? { openAiApiKey } : {}),
    openAiModel: env.OPENAI_MODEL ?? "gpt-5.6-terra",
    artifactPath: env.ARTIFACT_PATH ?? "/artifacts",
  };
}
