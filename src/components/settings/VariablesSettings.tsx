import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useVariableSnapshot } from "@/hooks/useVariableSnapshot";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateVariable, type VariableEntry } from "../../../coreza-backend/src/variables/contract";

export default function VariablesSettings() {
  const { user, session } = useAuth();
  const query = useVariableSnapshot(true);
  const client = useQueryClient();
  const [key, setKey] = useState("");
  const [type, setType] = useState("string");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const edit = (entry: VariableEntry) => { setKey(entry.key); setType(entry.value_type); setValue(entry.value_type === "string" ? String(entry.value) : JSON.stringify(entry.value)); setEditing(true); };
  const mutate = async (remove?: string) => {
    if (!query.data || busy) return;
    setBusy(true); setError("");
    try {
      const parsed = remove ? null : type === "string" ? value : JSON.parse(type === "null" ? "null" : value);
      if (!remove) {
        validateVariable(key, parsed);
        if ((parsed === null ? "null" : typeof parsed) !== type) throw new Error("Value must match the selected type");
      }
      const response = await apiClient.request(remove || editing ? `/variables/${encodeURIComponent(remove || key)}` : "/variables", {
        method: remove ? "DELETE" : editing ? "PATCH" : "POST",
        token: session?.access_token,
        body: JSON.stringify({ key, value: parsed, revision: query.data.revision }),
      });
      if (!response.ok) throw new Error(response.status === 409 ? "Variables changed or name already exists. Reload and retry." : "Variable update failed");
      if (!remove) { setKey(""); setValue(""); setEditing(false); }
      await client.invalidateQueries({ queryKey: ["workflow-variables", user?.id] });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Variable update failed"); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4 rounded-lg border p-4">
    <h2 className="text-lg font-semibold">Variables</h2>
    <p className="text-sm text-muted-foreground">Changes apply to new runs; restart an active live strategy to apply. Configuration only — use credentials for secrets.</p>
    <p className="text-sm text-muted-foreground">Use {"{{ $vars.BASE_RISK }}"} in Expression mode. Up to 128 scalar variables; names up to 64 characters, values up to 4 KB.</p>
    {(error || query.error) && <p role="alert" className="text-sm text-destructive">{error || "Variables unavailable"}</p>}
    {query.isLoading && <p>Loading variables…</p>}
    <table className="w-full text-sm"><thead><tr><th className="text-left">Name</th><th className="text-left">Type</th><th className="text-left">Value</th><th className="text-left">Updated</th><th /></tr></thead><tbody>
      {query.data?.entries.map(entry => <tr key={entry.key} className="border-t"><td>{entry.key}</td><td>{entry.value_type}</td><td className="max-w-48 break-words">{JSON.stringify(entry.value)}</td><td>{new Date(entry.updated_at).toLocaleString()}</td><td className="space-x-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => edit(entry)}>Edit</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => mutate(entry.key)}>Delete</Button></td></tr>)}
    </tbody></table>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void mutate(); }}>
      <div><Label htmlFor="variable-name">Name</Label><Input id="variable-name" value={key} maxLength={64} required disabled={busy || editing} onChange={event => setKey(event.target.value)} /></div>
      <div><Label htmlFor="variable-type">Type</Label><select id="variable-type" value={type} disabled={busy} onChange={event => setType(event.target.value)} className="block h-10 rounded-md border bg-background px-3">{["string", "number", "boolean", "null"].map(item => <option key={item}>{item}</option>)}</select></div>
      <div className="flex-1"><Label htmlFor="variable-value">Value</Label><Input id="variable-value" value={value} disabled={busy || type === "null"} onChange={event => setValue(event.target.value)} /></div>
      <Button type="submit" disabled={busy || !query.data}>{editing ? "Save" : "Add variable"}</Button>
      {editing && <Button type="button" variant="outline" onClick={() => { setEditing(false); setKey(""); setValue(""); }}>Cancel</Button>}
    </form>
  </div>;
}
