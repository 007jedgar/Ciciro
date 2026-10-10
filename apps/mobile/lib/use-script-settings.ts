import { useCallback, useEffect, useState } from "react";
import { ApiError, usePatchProjectMutation } from "./api";
import { parseScriptSettings, type ScriptSettings } from "./screenplay";

/**
 * The open screenplay's settings (page options, title page), read from the
 * manuscript row and written back with a project PATCH. A change shows at once
 * and is put back, with an error, when the server refuses it.
 */
export function useScriptSettings(project: { id: string; scriptSettings?: string }, saveError: string) {
  const stored = project.scriptSettings ?? "";
  const patch = usePatchProjectMutation();
  const [settings, setSettings] = useState<ScriptSettings>(() => parseScriptSettings(stored));
  const [error, setError] = useState<string | null>(null);

  // Follow the server when the row changes under us (a refetch, another device).
  useEffect(() => {
    setSettings(parseScriptSettings(stored));
  }, [stored]);

  const update = useCallback(
    (next: ScriptSettings) => {
      setSettings(next);
      setError(null);
      patch.mutate(
        { id: project.id, body: { scriptSettings: next } },
        {
          onError: (err) => {
            setSettings(parseScriptSettings(stored));
            setError(err instanceof ApiError ? err.message : saveError);
          },
        }
      );
    },
    // `patch` is a new object every render; its `mutate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.id, stored, saveError, patch.mutate]
  );

  return { settings, update, saving: patch.isPending, error };
}
