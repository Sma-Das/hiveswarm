export type ModelResponseItem = {
  type: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
};

export type ModelResponse = { id: string; output: ModelResponseItem[] };

export interface ModelProvider {
  readonly id: string;
  createResponse(request: Record<string, unknown>): Promise<ModelResponse>;
}

export function responseText(response: ModelResponse) {
  return response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

export class OpenAiResponsesProvider implements ModelProvider {
  readonly id = "openai";

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async createResponse(request: Record<string, unknown>): Promise<ModelResponse> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, ...request }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`OpenAI Responses API failed with status ${response.status}: ${detail}`);
    }
    return await response.json() as ModelResponse;
  }
}
