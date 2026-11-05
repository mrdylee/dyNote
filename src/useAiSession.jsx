import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultCopilotModel } from "../core/copilot-send-state.mjs";

const disconnected = { authenticated: false, login: "", models: [], error: "" };
const stored = (key) => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } };

export default function useAiSession(api) {
  const [provider, setProviderState] = useState(() => {
    const saved = stored("dynote.ai.provider");
    return ["copilot", "codex", "claude"].includes(saved) ? saved : "copilot";
  });
  const [models, setModels] = useState(() => Object.fromEntries(["copilot", "codex", "claude"].map(value => [value, stored(`dynote.${value}.model`)])));
  const [efforts, setEfforts] = useState({});
  const [snapshot, setSnapshot] = useState(null);
  const [activeChats, setActiveChats] = useState({});
  const [plannerActive, setPlannerActive] = useState(false);
  const activity = { chat: Object.keys(activeChats).length > 0, planner: plannerActive };
  const current = useRef(provider), pending = useRef(new Map());
  current.current = provider;
  const label = { copilot: "Copilot", codex: "Codex", claude: "Claude" }[provider];
  const ai = useMemo(() => ({
    status: api[`${provider}Status`], login: api[`${provider}Login`], cancelLogin: api[`${provider}CancelLogin`],
    send: api[`${provider}Send`], cancel: api[`${provider}Cancel`], onEvent: api[`on${label}Event`],
  }), [api, provider, label]);
  const setModel = useCallback(value => {
    setModels(old => ({ ...old, [provider]: value }));
    try { localStorage.setItem(`dynote.${provider}.model`, value); } catch { /* Keep the choice in memory. */ }
  }, [provider]);
  const refresh = useCallback(() => {
    if (pending.current.has(provider)) return pending.current.get(provider);
    setSnapshot(old => ({ provider, connection: old?.provider === provider ? old.connection : disconnected, checking: true }));
    const result = (async () => {
      try {
        const response = await ai.status();
        if (!response.ok) throw new Error(response.error);
        if (current.current !== provider) return;
        setSnapshot({ provider, connection: response.value, checking: false });
        setModels(old => ({ ...old, [provider]: defaultCopilotModel(response.value.models, old[provider]) }));
        return response.value;
      } catch (error) {
        if (current.current === provider) setSnapshot({ provider, connection: { ...disconnected, error: error.message }, checking: false });
      } finally { pending.current.delete(provider); }
    })();
    pending.current.set(provider, result);
    return result;
  }, [ai, provider]);
  useEffect(() => {
    refresh();
    return ai.onEvent(event => { if (event.type === "auth" && event.phase === "connected") refresh(); });
  }, [ai, refresh]);
  useEffect(() => {
    try { if (models[provider]) localStorage.setItem(`dynote.${provider}.model`, models[provider]); } catch { /* Keep the choice in memory. */ }
  }, [provider, models]);
  const setProvider = value => {
    if (activity.chat || activity.planner) return;
    setProviderState(value);
    try { localStorage.setItem("dynote.ai.provider", value); } catch { /* Keep the choice in memory. */ }
  };
  const setActivity = useCallback((owner, active, vaultId) => {
    if (owner === "planner") { setPlannerActive(active); return; }
    setActiveChats(old => {
      if (!!old[vaultId] === active) return old;
      const next = { ...old };
      if (active) next[vaultId] = true;
      else delete next[vaultId];
      return next;
    });
  }, []);
  const connection = snapshot?.provider === provider ? snapshot.connection : disconnected;
  const selectedModel = connection.models.find(model => model.id === models[provider]);
  const reasoningEfforts = selectedModel?.reasoningEfforts ?? [];
  const effortKey = `dynote.${provider}.reasoning.${encodeURIComponent(models[provider] ?? "")}`;
  const preferredEffort = efforts[effortKey] ?? stored(effortKey);
  const reasoningEffort = reasoningEfforts.includes(preferredEffort) ? preferredEffort : "";
  const setReasoningEffort = value => {
    if (activity.chat || activity.planner || (value !== "" && !reasoningEfforts.includes(value))) return;
    setEfforts(old => ({ ...old, [effortKey]: value }));
    try { localStorage.setItem(effortKey, value); } catch { /* Keep the choice in memory. */ }
  };
  return { provider, label, ai, model: models[provider], setModel, setProvider, refresh, activity, activeChats, setActivity,
    reasoningEfforts, reasoningEffort, setReasoningEffort, defaultReasoningEffort: selectedModel?.defaultReasoningEffort,
    connection,
    checking: snapshot?.provider !== provider || snapshot.checking };
}
