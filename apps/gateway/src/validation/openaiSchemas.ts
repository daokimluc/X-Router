import { z } from "zod";

export const openAIChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant", "tool"]),
      // Assistant messages that carry tool_calls send `content: null` per the
      // OpenAI spec — accept null/omitted so multi-turn tool calling round-trips.
      content: z.union([z.string(), z.array(z.record(z.unknown())), z.null()]).optional(),
      name: z.string().optional(),
      tool_calls: z.array(z.record(z.unknown())).optional(),
      tool_call_id: z.string().optional()
    }).passthrough()
  ).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  tools: z.array(z.record(z.unknown())).optional(),
  tool_choice: z.union([z.string(), z.record(z.unknown())]).optional()
}).passthrough();

export const anthropicMessagesRequestSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.union([z.string(), z.array(z.record(z.unknown()))])
      }).passthrough()
    )
    .min(1),
  system: z.union([z.string(), z.array(z.record(z.unknown()))]).optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  tools: z.array(z.record(z.unknown())).optional(),
  tool_choice: z.record(z.unknown()).optional()
}).passthrough();

