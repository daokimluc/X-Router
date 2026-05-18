/**
 * Speech-To-Text Providers Page — hardcoded provider catalog grid.
 */

import { Mic, Plus } from "lucide-react";
import { ProviderCatalogGrid } from "../components/ProviderCatalogGrid";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

export function STTProvidersPage(_props: { api: ApiClient; refresh: () => Promise<void> }) {
  return (
    <div className="stack">
      <div className="routesHeader">
        <div>
          <h2 className="routesTitle" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Mic size={22} />
            Speech To Text
          </h2>
          <p className="routesSubtitle">Manage your Speech To Text providers</p>
        </div>
        <button
          className="primaryButton"
          onClick={() => {
            // TODO: wire up custom-stt flow
          }}
        >
          <Plus size={14} />
          Add Custom Speech To Text
        </button>
      </div>

      <ProviderCatalogGrid api={_props.api} kind="stt" kindLabel="Speech To Text" />
    </div>
  );
}
