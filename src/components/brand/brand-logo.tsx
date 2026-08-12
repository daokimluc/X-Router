import type { SVGProps } from "react";
import {
  OpenAILogo,
  AnthropicLogo,
  DeepSeekLogo,
  MistralLogo,
  CursorLogo,
} from "./logos.generated";

type LogoProps = SVGProps<SVGSVGElement> & { className?: string };

// Gemini — official Google gradient (blue → purple → pink-red).
const GEMINI_PATH =
  "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81";

export function GeminiLogo({ className, ...props }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...props}>
      <defs>
        <linearGradient id="gemini-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4285F4" />
          <stop offset="0.5" stopColor="#9B72CB" />
          <stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path d={GEMINI_PATH} fill="url(#gemini-grad)" />
    </svg>
  );
}

// Claude Code reuses the Anthropic glyph (monochrome, currentColor).
export const ClaudeCodeLogo = AnthropicLogo;

// OpenCode — terminal/brackets glyph
export function OpenCodeLogo({ className, ...props }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </svg>
  );
}

// Codex CLI — terminal prompt glyph
export function CodexLogo({ className, ...props }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden {...props}>
      <path d="m4 17 6-6-6-6M12 19h8" />
    </svg>
  );
}

// OpenClaw — agent/node glyph
export function OpenClawLogo({ className, ...props }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden {...props}>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="19" r="2.5" />
      <circle cx="19" cy="19" r="2.5" />
      <path d="M12 7.5v4M10 13l-3.5 4M14 13l3.5 4" />
    </svg>
  );
}

// Harness — workflow/flow glyph
export function HarnessLogo({ className, ...props }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden {...props}>
      <rect x="3" y="4" width="6" height="6" rx="1.5" />
      <rect x="15" y="14" width="6" height="6" rx="1.5" />
      <path d="M9 7h4a2 2 0 0 1 2 2v8" />
    </svg>
  );
}

// Discord — official simple-icons glyph (monochrome, currentColor).
const DISCORD_PATH =
  "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z";

export function DiscordLogo({ className, ...props }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden {...props}>
      <path d={DISCORD_PATH} />
    </svg>
  );
}

// Zalo — official simple-icons glyph (monochrome, currentColor).
const ZALO_PATH =
  "M12.49 10.2722v-.4496h1.3467v6.3218h-.7704a.576.576 0 01-.5763-.5729l-.0006.0005a3.273 3.273 0 01-1.9372.6321c-1.8138 0-3.2844-1.4697-3.2844-3.2823 0-1.8125 1.4706-3.2822 3.2844-3.2822a3.273 3.273 0 011.9372.6321l.0006.0005zM6.9188 7.7896v.205c0 .3823-.051.6944-.2995 1.0605l-.03.0343c-.0542.0615-.1815.206-.2421.2843L2.024 14.8h4.8948v.7682a.5764.5764 0 01-.5767.5761H0v-.3622c0-.4436.1102-.6414.2495-.8476L4.8582 9.23H.1922V7.7896h6.7266zm8.5513 8.3548a.4805.4805 0 01-.4803-.4798v-7.875h1.4416v8.3548H15.47zM20.6934 9.6C22.52 9.6 24 11.0807 24 12.9044c0 1.8252-1.4801 3.306-3.3066 3.306-1.8264 0-3.3066-1.4808-3.3066-3.306 0-1.8237 1.4802-3.3044 3.3066-3.3044zm-10.1412 5.253c1.0675 0 1.9324-.8645 1.9324-1.9312 0-1.065-.865-1.9295-1.9324-1.9295s-1.9324.8644-1.9324 1.9295c0 1.0667.865 1.9312 1.9324 1.9312zm10.1412-.0033c1.0737 0 1.945-.8707 1.945-1.9453 0-1.073-.8713-1.9436-1.945-1.9436-1.0753 0-1.945.8706-1.945 1.9436 0 1.0746.8697 1.9453 1.945 1.9453z";

export function ZaloLogo({ className, ...props }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden {...props}>
      <path d={ZALO_PATH} />
    </svg>
  );
}

const PROVIDER_LOGOS: Record<string, (p: LogoProps) => React.ReactElement> = {
  OpenAI: OpenAILogo,
  "OpenAI Codex": OpenAILogo,
  Anthropic: AnthropicLogo,
  Google: GeminiLogo,
  DeepSeek: DeepSeekLogo,
  Mistral: MistralLogo,
};

const TOOL_LOGOS: Record<string, (p: LogoProps) => React.ReactElement> = {
  OpenCode: OpenCodeLogo,
  Cursor: CursorLogo,
  "Claude Code": ClaudeCodeLogo,
  "Codex CLI": CodexLogo,
  OpenClaw: OpenClawLogo,
  "Harness Agent": HarnessLogo,
};

// Official brand colors (simple-icons). OpenAI/Cursor are monochrome brands
// (black on light, white on dark) → `null` = currentColor, which is correct.
const BRAND_COLORS: Record<string, string | null> = {
  OpenAI: null,
  "OpenAI Codex": null,
  Anthropic: "#D97757",
  Google: null,
  DeepSeek: "#5786FE",
  Mistral: "#FA520F",
  OpenCode: null,
  Cursor: null,
  "Claude Code": "#D97757",
  "Codex CLI": null,
  OpenClaw: null,
  "Harness Agent": null,
};

/** Logo for a model provider; brand-colored, falls back to a 2-letter avatar. */
export function ProviderLogo({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  const Logo = PROVIDER_LOGOS[provider];
  const color = BRAND_COLORS[provider];
  if (Logo)
    return (
      <Logo
        className={className}
        style={color ? { color } : undefined}
      />
    );
  return (
    <span className="grid h-full w-full place-items-center text-[10px] font-bold">
      {provider.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Logo for an integration tool; brand-colored where available, falls back to initials. */
export function ToolLogo({
  tool,
  className,
}: {
  tool: string;
  className?: string;
}) {
  const Logo = TOOL_LOGOS[tool];
  const color = BRAND_COLORS[tool];
  if (Logo)
    return (
      <Logo className={className} style={color ? { color } : undefined} />
    );
  return (
    <span className="grid h-full w-full place-items-center text-[11px] font-bold">
      {tool
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()}
    </span>
  );
}
