import { z } from "zod";

export const openAIChatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant", "tool"]),
      content: z.union([z.string(), z.array(z.record(z.unknown()))]),
      name: z.string().optional()
    })
  ).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional()
});

export const anthropicMessagesRequestSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.union([z.string(), z.array(z.record(z.unknown()))])
      })
    )
    .min(1),
  system: z.union([z.string(), z.array(z.record(z.unknown()))]).optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional()
});

