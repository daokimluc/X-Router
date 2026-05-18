/**
 * Text-to-Image Providers Page — hardcoded provider catalog grid.
 */

import { Brush, Plus } from "lucide-react";
import { ProviderCatalogGrid } from "../components/ProviderCatalogGrid";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

export function ImageProvidersPage(_props: { api: ApiClient; refresh: () => Promise<void> }) {
  return (
    <div className="stack">
      <div className="routesHeader">
        <div>
          <h2 className="routesTitle" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Brush size={22} />
            Text to Image
          </h2>
          <p className="routesSubtitle">Manage your Text to Image providers</p>
        </div>
        <button
          className="primaryButton"
          onClick={() => {
            // TODO: wire up custom-image provider flow
          }}
        >
          <Plus size={14} />
          Add Custom Text to Image
        </button>
      </div>

      <ProviderCatalogGrid api={_props.api} kind="image" kindLabel="Text to Image" />
    </div>
  );
}
