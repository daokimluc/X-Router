import { useEffect, useState } from "react";
import type { CatalogProvider, ServiceKind } from "../providerCatalog";
import { getProvidersByKind } from "../providerCatalog";
import { ProviderCatalogCard } from "./ProviderCatalogCard";
import { ProviderDetailView } from "./ProviderDetailView";

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

type ProviderInstance = {
  id: string;
  type: string;
  name: string;
  enabled?: boolean;
};

type Props = {
  api: ApiClient;
  kind: ServiceKind;
  kindLabel: string;
};

/**
 * Renders the hardcoded catalog of providers for a given service kind
 * as a 4-column responsive grid. Pulls live provider instance counts
 * from the gateway to display "X Connected" status on each card.
 *
 * When a provider is selected, the grid is replaced by a detail view.
 */
export function ProviderCatalogGrid({ api, kind, kindLabel }: Props) {
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const [selected, setSelected] = useState<CatalogProvider | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getList<ProviderInstance>(`/admin/v1/media-providers?kind=${kind}`)
      .then((rows) => {
        if (!cancelled) setInstances(rows);
      })
      .catch(() => {
        if (!cancelled) setInstances([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, kind]);

  // Reset selection when navigating between kinds.
  useEffect(() => {
    setSelected(null);
  }, [kind]);

  if (selected) {
    return (
      <ProviderDetailView
        api={api}
        provider={selected}
        kind={kind}
        kindLabel={kindLabel}
        onBack={() => setSelected(null)}
      />
    );
  }

  const providers = getProvidersByKind(kind);

  const counts = new Map<string, number>();
  for (const instance of instances) {
    const id = instance.type;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: "12px",
      }}
    >
      {providers.map((p) => (
        <ProviderCatalogCard
          key={p.id}
          provider={p}
          connectionCount={counts.get(p.id) ?? counts.get(p.alias) ?? 0}
          onClick={() => setSelected(p)}
        />
      ))}
    </div>
  );
}
