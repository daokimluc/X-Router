/**
 * Google Translate TTS — server-side scrape of Google Translate's
 * batchexecute RPC endpoint. No API key required.
 *
 * Ported from 9router: open-sse/handlers/ttsProviders/googleTts.js
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFRESH_MS = 11 * 60 * 1000;

let cachedToken: { "f.sid": string; bl: string } | null = null;
let cachedTokenTime = 0;
let reqIdx = 0;

async function getToken(): Promise<{ "f.sid": string; bl: string }> {
  const now = Date.now();
  if (cachedToken && now - cachedTokenTime < REFRESH_MS) return cachedToken;

  const res = await fetch("https://translate.google.com/", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`Google translate fetch failed: ${res.status}`);
  const html = await res.text();

  const fSid = html.match(/"FdrFJe":"(.*?)"/)?.[1];
  const bl = html.match(/"cfb2h":"(.*?)"/)?.[1];
  if (!fSid || !bl) throw new Error("Failed to parse Google TTS token");

  cachedToken = { "f.sid": fSid, bl };
  cachedTokenTime = now;
  return cachedToken;
}

/**
 * Synthesize text using Google Translate TTS.
 * @param text - Text to speak
 * @param lang - Language code (e.g. "en", "vi", "ja"). Defaults to "en".
 * @returns Base64-encoded MP3 audio
 */
export async function synthesizeGoogleTts(
  text: string,
  lang?: string
): Promise<{ base64: string; format: string }> {
  const language = lang || "en";
  const token = await getToken();

  // Clean text for TTS
  const cleanText = text
    .replace(/[@^*()\\/\-_+=><"'\u201c\u201d\u3010\u3011]/g, " ")
    .replaceAll(", ", ". ");

  const rpcId = "jQ1olc";
  reqIdx++;
  const reqId = reqIdx * 100000 + Math.floor(1000 + Math.random() * 9000);

  const query = new URLSearchParams({
    rpcids: rpcId,
    "f.sid": token["f.sid"],
    bl: token.bl,
    hl: language,
    "soc-app": "1",
    "soc-platform": "1",
    "soc-device": "1",
    _reqid: String(reqId),
    rt: "c",
  });

  const payload = [cleanText, language, null, "undefined", [0]];
  const body = new URLSearchParams();
  body.append(
    "f.req",
    JSON.stringify([[[rpcId, JSON.stringify(payload), null, "generic"]]])
  );

  const res = await fetch(
    `https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?${query}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://translate.google.com/",
      },
      body: body.toString(),
    }
  );

  if (!res.ok) throw new Error(`Google TTS failed: ${res.status}`);

  const data = await res.text();
  const lines = data.split("\n");
  if (lines.length < 4) throw new Error("Google TTS returned unexpected response");

  const split = JSON.parse(lines[3]);
  const base64 = JSON.parse(split[0][2])[0] as string;
  if (!base64 || base64.length < 100) {
    throw new Error("Google TTS returned empty audio");
  }

  return { base64, format: "mp3" };
}
