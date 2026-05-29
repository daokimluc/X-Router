/**
 * VersionBadge — reads /admin/v1/version and shows:
 *   - "Control Plane v0.3.1" by default
 *   - when an update exists: an "Update available · v0.3.2" badge plus the
 *     exact npm command to run, with a copy button.
 *
 * The endpoint caches for 1 hour server-side, so polling here is cheap.
 */

import { useEffect, useState } from "react";
import { Sparkles, Copy, Check } from "lucide-react";
import { copyText } from "../clipboard";

type ApiClient = {
  get: <T>(path: string) => Promise<T>;
};

type VersionInfo = {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
};

const UPDATE_COMMAND = "npm i -g @daokimluc/x-router@latest";

export function VersionBadge({ api }: { api?: ApiClient }) {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!api) return;
    let active = true;
    api.get<VersionInfo>("/admin/v1/version")
      .then((r) => { if (active) setInfo(r); })
      .catch(() => {});
    return () => { active = false; };
  }, [api]);

  async function handleCopy() {
    const ok = await copyText(UPDATE_COMMAND);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  if (!info) {
    return <span className="brandSubtitle">Control Plane</span>;
  }

  return (
    <div className="brandSubtitleStack">
      <span className="brandSubtitle">Control Plane v{info.current}</span>
      {info.hasUpdate && info.latest && (
        <>
          <a
            href="https://www.npmjs.com/package/@daokimluc/x-router"
            target="_blank"
            rel="noreferrer"
            className="brandUpdateBadge"
            title={`Update available: v${info.latest}. Click to view release notes.`}
          >
            <Sparkles size={11} />
            <span>Update available · v{info.latest}</span>
          </a>
          <div className="brandUpdateCmd">
            <code>{UPDATE_COMMAND}</code>
            <button
              type="button"
              className="brandUpdateCopyBtn"
              onClick={() => void handleCopy()}
              title="Copy update command"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
