/**
 * Token Saver — compresses tool output and injects terse system prompts.
 *
 * Inspired by RTK (https://github.com/rtk-ai/rtk) for tool output compression
 * and Caveman-style terse prompts for LLM output reduction.
 */

// ─── Types ─────────────────────────────────────────────────

export type TokenSaverSettings = {
  compressToolOutput: boolean;
  compressLlmOutput: boolean;
  llmCompressionMode: "lite" | "full" | "ultra";
};

export const DEFAULT_TOKEN_SAVER_SETTINGS: TokenSaverSettings = {
  compressToolOutput: false,
  compressLlmOutput: false,
  llmCompressionMode: "full",
};

// ─── ANSI strip ────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

// ─── Noise patterns (progress bars, timestamps, download indicators) ───

const NOISE_PATTERNS = [
  /^\s*[\|\/\-\\]\s*$/,                          // spinner chars
  /^\s*\d+%\s*[\|█▓▒░■□]+/,                     // progress bars
  /^\s*(?:Downloading|Fetching|Installing).*\.\.\.\s*$/i, // download lines
  /^\s*\[[\d:]+\]\s*$/,                          // bare timestamps
  /^\s*npm warn/i,                               // npm warnings
  /^\s*(?:added|removed|changed)\s+\d+\s+package/i, // npm summary noise
  /^\s*up to date/i,                             // npm up to date
  /^\s*\d+ packages? are looking for funding/i,  // npm funding
  /^\s*run `npm fund`/i,                         // npm fund hint
];

function isNoiseLine(line: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(line));
}

// ─── Tool output compression ───────────────────────────────

const HEAD_LINES = 50;
const TAIL_LINES = 20;
const MAX_LINE_LENGTH = 500;

/**
 * Compress tool output (role=tool messages) to reduce input tokens.
 *
 * Pipeline (inspired by RTK):
 *   1. Strip ANSI escape codes
 *   2. Strip noise lines (progress bars, spinners, npm warnings)
 *   3. Collapse consecutive blank lines to max 1
 *   4. Truncate individual lines to 500 chars
 *   5. Head/tail: keep first 50 + last 20 lines if over 80 total
 */
export function compressToolOutput(content: string): string {
  if (!content || content.length < 200) {
    return content; // too short to bother
  }

  // 1. Strip ANSI
  let text = stripAnsi(content);

  // 2. Split into lines, strip noise
  let lines = text.split("\n").filter((line) => !isNoiseLine(line));

  // 3. Collapse consecutive blank lines
  const collapsed: string[] = [];
  let prevBlank = false;
  for (const line of lines) {
    const isBlank = line.trim() === "";
    if (isBlank && prevBlank) {
      continue;
    }
    collapsed.push(line);
    prevBlank = isBlank;
  }
  lines = collapsed;

  // 4. Truncate long lines
  lines = lines.map((line) =>
    line.length > MAX_LINE_LENGTH
      ? line.slice(0, MAX_LINE_LENGTH - 3) + "..."
      : line
  );

  // 5. Head/tail truncation
  const total = lines.length;
  if (total > HEAD_LINES + TAIL_LINES) {
    const head = lines.slice(0, HEAD_LINES);
    const tail = lines.slice(total - TAIL_LINES);
    const omitted = total - HEAD_LINES - TAIL_LINES;
    lines = [...head, `\n... (${omitted} lines omitted)\n`, ...tail];
  }

  return lines.join("\n").trim();
}

// ─── Caveman system prompts ────────────────────────────────

const CAVEMAN_LITE = `Response style: be concise. Skip unnecessary preambles, filler phrases, and verbose explanations. Get to the point quickly. Use short sentences. Omit "certainly", "of course", "I'd be happy to", etc.`;

const CAVEMAN_FULL = `Response style: TERSE MODE ACTIVE.
Rules:
- No preambles, no filler, no "certainly/of course/I'd be happy to"
- Skip explanations unless explicitly asked
- Code: just the code, no surrounding prose unless asked
- Lists: bullet points, no full sentences
- Answers: direct, minimal words
- Never repeat the question back
- Never say "Here's" or "Here is"
- If asked to explain, be brief`;

const CAVEMAN_ULTRA = `ULTRA-TERSE MODE. Rules:
- Max 1-2 sentences per answer unless code
- Code only, zero prose around it
- No greetings, no sign-offs, no filler
- No "I", no "Let me", no hedging
- Lists: bare items, no descriptions
- If unclear, ask in ≤5 words
- Never acknowledge instructions`;

/**
 * Get the Caveman system prompt for the given compression mode.
 */
export function getCavemanPrompt(
  mode: TokenSaverSettings["llmCompressionMode"]
): string {
  switch (mode) {
    case "lite":
      return CAVEMAN_LITE;
    case "full":
      return CAVEMAN_FULL;
    case "ultra":
      return CAVEMAN_ULTRA;
    default:
      return CAVEMAN_FULL;
  }
}

// ─── Service class ─────────────────────────────────────────

export class TokenSaverService {
  private settings: TokenSaverSettings = { ...DEFAULT_TOKEN_SAVER_SETTINGS };

  getSettings(): TokenSaverSettings {
    return { ...this.settings };
  }

  updateSettings(partial: Partial<TokenSaverSettings>): TokenSaverSettings {
    if (partial.compressToolOutput !== undefined) {
      this.settings.compressToolOutput = partial.compressToolOutput;
    }
    if (partial.compressLlmOutput !== undefined) {
      this.settings.compressLlmOutput = partial.compressLlmOutput;
    }
    if (
      partial.llmCompressionMode &&
      ["lite", "full", "ultra"].includes(partial.llmCompressionMode)
    ) {
      this.settings.llmCompressionMode = partial.llmCompressionMode;
    }
    return this.getSettings();
  }

  loadSettings(saved: Partial<TokenSaverSettings> | undefined): void {
    if (saved) {
      this.updateSettings(saved);
    }
  }

  /**
   * Apply token saver transformations to a messages array (mutates in place).
   * Returns the modified messages.
   */
  applyToMessages(
    messages: Array<{ role: string; content: unknown }>
  ): Array<{ role: string; content: unknown }> {
    if (!this.settings.compressToolOutput && !this.settings.compressLlmOutput) {
      return messages;
    }

    const result = [...messages];

    // Compress tool output
    if (this.settings.compressToolOutput) {
      for (let i = 0; i < result.length; i++) {
        const msg = result[i];
        if (msg.role === "tool" && typeof msg.content === "string") {
          result[i] = { ...msg, content: compressToolOutput(msg.content) };
        }
      }
    }

    // Inject caveman system prompt
    if (this.settings.compressLlmOutput) {
      const cavemanPrompt = getCavemanPrompt(this.settings.llmCompressionMode);
      const hasSystem = result.some((m) => m.role === "system");
      if (hasSystem) {
        // Append to existing system message
        for (let i = 0; i < result.length; i++) {
          if (result[i].role === "system") {
            const existing =
              typeof result[i].content === "string"
                ? result[i].content
                : "";
            result[i] = {
              ...result[i],
              content: `${existing}\n\n${cavemanPrompt}`,
            };
            break;
          }
        }
      } else {
        // Prepend new system message
        result.unshift({ role: "system", content: cavemanPrompt });
      }
    }

    return result;
  }
}
