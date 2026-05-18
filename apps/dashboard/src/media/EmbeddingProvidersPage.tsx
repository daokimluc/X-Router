/**
 * Embedding Providers Page — hardcoded provider catalog grid for embeddings.
 */

import { Brackets, Plus } from "lucide-react";
import { ProviderCatalogGrid } from "../components/ProviderCatalogGrid";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

export function EmbeddingProvidersPage(_props: { api: ApiClient; refresh: () => Promise<void> }) {
  return (
    <div className="stack">
      <div className="routesHeader">
        <div>
          <h2 className="routesTitle" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Brackets size={22} />
            Embedding
          </h2>
          <p className="routesSubtitle">Manage your Embedding providers</p>
        </div>
        <button
          className="primaryButton"
          onClick={() => {
            // TODO: wire up custom-embedding flow
          }}
        >
          <Plus size={14} />
          Add Custom Embedding
        </button>
      </div>

      <ProviderCatalogGrid api={_props.api} kind="embedding" kindLabel="Embedding" />
    </div>
  );
}
