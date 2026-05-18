/**
 * Web Fetch & Search Providers Page — two hardcoded catalog grids,
 * one for Web Search and one for Web Fetch, each with a "Create Combo" button.
 */

import { FolderSearch, Layers, Plus } from "lucide-react";
import { ProviderCatalogGrid } from "../components/ProviderCatalogGrid";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

export function WebProvidersPage(props: { api: ApiClient; refresh: () => Promise<void> }) {
  return (
    <div className="stack">
      <div className="routesHeader">
        <div>
          <h2 className="routesTitle" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FolderSearch size={22} />
            web
          </h2>
          <p className="routesSubtitle">Manage your Web Search and Web Fetch providers</p>
        </div>
        <button
          className="primaryButton"
          onClick={() => {
            // TODO: wire up custom-web flow
          }}
        >
          <Plus size={14} />
          Add Custom Web
        </button>
      </div>

      {/* Web Search */}
      <section>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Web Search</h3>
          <button className="primaryButton">
            <Layers size={14} />
            Create Combo
          </button>
        </div>
        <ProviderCatalogGrid api={props.api} kind="webSearch" kindLabel="Web Search" />
      </section>

      <div style={{ borderTop: "1px solid var(--color-border)", margin: "8px 0" }} />

      {/* Web Fetch */}
      <section>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Web Fetch</h3>
          <button className="primaryButton">
            <Layers size={14} />
            Create Combo
          </button>
        </div>
        <ProviderCatalogGrid api={props.api} kind="webFetch" kindLabel="Web Fetch" />
      </section>
    </div>
  );
}
