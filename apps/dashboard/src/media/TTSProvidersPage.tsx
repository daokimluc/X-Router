/**
 * Text-To-Speech Providers Page — hardcoded provider catalog grid.
 */

import { AudioWaveform, Plus } from "lucide-react";
import { ProviderCatalogGrid } from "../components/ProviderCatalogGrid";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

export function TTSProvidersPage(_props: { api: ApiClient; refresh: () => Promise<void> }) {
  return (
    <div className="stack">
      <div className="routesHeader">
        <div>
          <h2 className="routesTitle" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AudioWaveform size={22} />
            Text To Speech
          </h2>
          <p className="routesSubtitle">Manage your Text To Speech providers</p>
        </div>
        <button
          className="primaryButton"
          onClick={() => {
            // TODO: wire up custom-tts flow
          }}
        >
          <Plus size={14} />
          Add Custom Text To Speech
        </button>
      </div>

      <ProviderCatalogGrid api={_props.api} kind="tts" kindLabel="Text To Speech" />
    </div>
  );
}
