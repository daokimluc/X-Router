/**
 * Microsoft Edge / Bing TTS — server-side scrape of Bing Translator's
 * TTS endpoint. No API key required.
 *
 * Ported from 9router: open-sse/handlers/ttsProviders/edgeTts.js
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFRESH_MS = 5 * 60 * 1000;

let cachedToken: { key: string; token: string; cookie: string } | null = null;
let cachedTokenTime = 0;

async function getToken(): Promise<{ key: string; token: string; cookie: string }> {
  const now = Date.now();
  if (cachedToken && now - cachedTokenTime < REFRESH_MS) return cachedToken;

  const res = await fetch("https://www.bing.com/translator", {
    headers: { "User-Agent": UA, "Accept-Language": "vi,en-US;q=0.9,en;q=0.8" },
  });
  if (!res.ok) throw new Error(`Bing translator fetch failed: ${res.status}`);

  const rawCookies = res.headers.getSetCookie?.() || [];
  const cookie = rawCookies.map((c: string) => c.split(";")[0]).join("; ");
  const html = await res.text();

  const match = html.match(/params_AbusePreventionHelper\s*=\s*\[([^,]+),([^,]+),/);
  if (!match) throw new Error("Failed to parse Bing TTS token");

  cachedToken = { key: match[1], token: match[2].replace(/"/g, ""), cookie };
  cachedTokenTime = now;
  return cachedToken;
}

/**
 * Synthesize text using Microsoft Edge / Bing TTS.
 * @param text - Text to speak
 * @param voiceId - Voice name (e.g. "vi-VN-HoaiMyNeural"). Defaults to "vi-VN-HoaiMyNeural".
 * @returns Base64-encoded MP3 audio
 */
export async function synthesizeEdgeTts(
  text: string,
  voiceId?: string
): Promise<{ base64: string; format: string }> {
  const voice = voiceId || "vi-VN-HoaiMyNeural";

  const parts = voice.split("-");
  const xmlLang = parts.slice(0, 2).join("-");
  const gender = voice.toLowerCase().includes("male") ? "Male" : "Female";

  const ssml = `<speak version='1.0' xml:lang='${xmlLang}'><voice xml:lang='${xmlLang}' xml:gender='${gender}' name='${voice}'><prosody rate='0.00%'>${text}</prosody></voice></speak>`;

  let token = await getToken();
  let res = await doRequest(ssml, token);

  // 429/403: invalidate cache and retry once
  if (res.status === 429 || res.status === 403) {
    cachedToken = null;
    cachedTokenTime = 0;
    token = await getToken();
    res = await doRequest(ssml, token);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bing TTS failed: ${res.status}${body ? " - " + body : ""}`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength < 1024) throw new Error("Bing TTS returned empty audio");

  return {
    base64: Buffer.from(buf).toString("base64"),
    format: "mp3",
  };
}

async function doRequest(
  ssml: string,
  token: { key: string; token: string; cookie: string }
): Promise<Response> {
  const body = new URLSearchParams();
  body.append("ssml", ssml);
  body.append("token", token.token);
  body.append("key", token.key);

  return fetch(
    "https://www.bing.com/tfettts?isVertical=1&&IG=1&IID=translator.5023&SFX=1",
    {
      method: "POST",
      body: body.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "*/*",
        Origin: "https://www.bing.com",
        Referer: "https://www.bing.com/translator",
        "User-Agent": UA,
        ...(token.cookie ? { Cookie: token.cookie } : {}),
      },
    }
  );
}
