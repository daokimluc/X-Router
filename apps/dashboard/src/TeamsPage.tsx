/**
 * Teams Page — manage team quotas and access control.
 */

import { useState } from "react";
import { Plus, Users, Trash2, X } from "lucide-react";
import { useLang } from "./i18n";
import { ConfirmDialog } from "./components/ConfirmDialog";

export type Team = {
  id: string;
  name: string;
  enabled: boolean;
  description?: string;
  allowedModels?: string[];
  allowedProviders?: string[];
  rpmLimit?: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  createdAt: string;
  updatedAt: string;
};

type ApiClient = {
  get<T>(path: string): Promise<T>;
  getList<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
};

export function TeamsPage(props: { api: ApiClient; refresh: () => Promise<void> }) {
  const { t } = useLang();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Team | null>(null);

  // Load teams on mount
  if (!loaded) {
    props.api.getList<Team>("/admin/v1/teams").then(setTeams).catch(() => {}).finally(() => setLoaded(true));
  }

  async function reload() {
    const data = await props.api.getList<Team>("/admin/v1/teams");
    setTeams(data);
  }

  async function deleteTeam(team: Team) {
    setPendingDelete(team);
  }

  async function confirmDeleteTeam() {
    const team = pendingDelete;
    if (!team) return;
    setPendingDelete(null);
    try {
      await props.api.delete(`/admin/v1/teams/${team.id}`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function toggleEnabled(team: Team) {
    await props.api.patch(`/admin/v1/teams/${team.id}`, { enabled: !team.enabled });
    await reload();
  }

  return (
    <div className="stack">
      <div className="routesHeader">
        <div>
          <h2 className="routesTitle">{t("teams.title")}</h2>
          <p className="routesSubtitle">{t("teams.subtitle")}</p>
        </div>
        <button className="primaryButton" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> {t("teams.createTeam")}
        </button>
      </div>

      {error && <div className="endpointError">{error}</div>}

      {teams.length === 0 && loaded ? (
        <div className="routesEmpty">
          <Users size={24} />
          <p>{t("teams.noTeams")}</p>
          <small>{t("teams.noTeamsHint")}</small>
        </div>
      ) : (
        <div className="routesList">
          {teams.map((team) => (
            <div key={team.id} className={`routeCard ${!team.enabled ? "routeCard--disabled" : ""}`}>
              <div className="routeCardLeft">
                <Users size={18} className="routeIcon" />
                <div className="routeCardInfo">
                  <strong>{team.name}</strong>
                  <div className="routeModelTags">
                    {team.rpmLimit && <span className="routeModelTag">{team.rpmLimit} RPM</span>}
                    {team.dailyLimit && <span className="routeModelTag">{team.dailyLimit}/day</span>}
                    {team.monthlyLimit && <span className="routeModelTag">{team.monthlyLimit}/mo</span>}
                    {team.allowedModels?.length ? <span className="routeModelTag">{team.allowedModels.join(", ")}</span> : <span className="routeModelTag">{t("teams.allModels")}</span>}
                  </div>
                </div>
              </div>
              <div className="routeCardRight">
                <button
                  type="button"
                  role="switch"
                  aria-checked={team.enabled}
                  className={`toggleSwitch ${team.enabled ? "on" : "off"}`}
                  onClick={() => void toggleEnabled(team)}
                >
                  <span className="toggleSwitchKnob" />
                </button>
                <button className="iconButton danger" title={t("common.delete")} onClick={() => void deleteTeam(team)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTeamModal
          api={props.api}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void reload(); }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={t("teams.deleteTeam") ?? "Delete team"}
          message={`${t("teams.deleteConfirm") ?? "Delete team"} "${pendingDelete.name}"?`}
          confirmLabel={t("common.delete") ?? "Delete"}
          cancelLabel={t("common.cancel") ?? "Cancel"}
          onConfirm={() => void confirmDeleteTeam()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function CreateTeamModal(props: { api: ApiClient; onClose: () => void; onCreated: () => void }) {
  const { t } = useLang();
  const [name, setName] = useState("");
  const [rpmLimit, setRpmLimit] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [allowedModels, setAllowedModels] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const models = allowedModels.trim()
        ? allowedModels.split(",").map((m) => m.trim()).filter(Boolean)
        : undefined;
      await props.api.post("/admin/v1/teams", {
        name: name.trim(),
        rpmLimit: rpmLimit ? parseInt(rpmLimit, 10) : undefined,
        dailyLimit: dailyLimit ? parseInt(dailyLimit, 10) : undefined,
        allowedModels: models,
      });
      props.onCreated();
    } catch { /* ignore */ } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modalContent routeModal">
        <div className="modalHeader">
          <div className="modalDots"><span /><span /><span /></div>
          <h2>{t("teams.createTeam")}</h2>
          <button className="iconButton" onClick={props.onClose}><X size={20} /></button>
        </div>
        <form className="routeForm" onSubmit={(e) => void submit(e)}>
          <label className="routeFormLabel">
            {t("teams.teamName")}
            <input className="routeNameInput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Frontend" autoFocus />
          </label>
          <label className="routeFormLabel">
            {t("teams.allowedModels")}
            <input className="routeNameInput" value={allowedModels} onChange={(e) => setAllowedModels(e.target.value)} placeholder="kiro-sonnet, windsurf-sonnet, coding" />
            <small style={{fontSize:"11px",color:"#9ca3af"}}>{t("teams.allowedModelsHint")}</small>
          </label>
          <label className="routeFormLabel">
            {t("teams.rpmLimit")}
            <input className="routeNameInput" type="number" value={rpmLimit} onChange={(e) => setRpmLimit(e.target.value)} placeholder="60" />
            <small style={{fontSize:"11px",color:"#9ca3af"}}>{t("teams.rpmLimitHint")}</small>
          </label>
          <label className="routeFormLabel">
            {t("teams.dailyLimit")}
            <input className="routeNameInput" type="number" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} placeholder="5000" />
            <small style={{fontSize:"11px",color:"#9ca3af"}}>{t("teams.dailyLimitHint")}</small>
          </label>
          <div className="routeModalFooter">
            <button type="button" className="ghostButton" onClick={props.onClose}>{t("common.cancel")}</button>
            <button type="submit" className="primaryButton" disabled={busy || !name.trim()}>
              {busy ? t("teams.creating") : t("common.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
