/**
 * VersionBadge — reads /admin/v1/version and shows:
 *   - "Control Plane v0.2.0" by default
 *   - "Control Plane v0.2.0 · update v0.3.0 available" when an update exists
 *
 * The endpoint caches for 1 hour server-side, so polling here is cheap.
 */

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

type ApiClient = {
  get: <T>(path: string) => Promise<T>;
};

type VersionInfo = {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
};

export function VersionBadge({ api }: { api?: ApiClient }) {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    if (!api) return;
    let active = true;
    api.get<VersionInfo>("/admin/v1/version")
      .then((r) => { if (active) setInfo(r); })
      .catch(() => {});
    return () => { active = false; };
  }, [api]);

  if (!info) {
    return <span className="brandSubtitle">Control Plane</span>;
  }

  return (
    <div className="brandSubtitleStack">
      <span className="brandSubtitle">Control Plane v{info.current}</span>
      {info.hasUpdate && info.latest && (
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
      )}
    </div>
  );
}
