import type { AxiosError } from "axios";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AddAppModal, type AddAppPayload } from "../components/AddAppModal";
import { api } from "../services/api";
import { useAuthStore } from "../stores/authStore";
import type { ApiErrorResponse, AppDraft, AppEntry } from "../types";

const ADMIN_APPS_QUERY_KEY = ["admin-apps"];

interface SortableRowProps {
  app: AppEntry;
  draft: Partial<AppEntry> | undefined;
  onChange: (id: string, patch: Partial<AppEntry>) => void;
  onSave: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const SortableRow = ({ app, draft, onChange, onSave, onDelete }: SortableRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

  const name = draft?.name ?? app.name;
  const executablePath = draft?.executablePath ?? app.executablePath;
  const category = draft?.category ?? app.category ?? "";

  return (
    <tr ref={setNodeRef} style={style} className="border-b border-white/6 align-top last:border-b-0">
      <td className="p-3 text-center">
        <button type="button" {...attributes} {...listeners} className="secondary-button px-3 py-2 text-xs">
          Drag
        </button>
      </td>
      <td className="p-3 text-xs text-white/45">{app.sortOrder}</td>
      <td className="p-3">
        <input value={name} onChange={(event) => onChange(app.id, { name: event.target.value })} className="field-input" />
      </td>
      <td className="p-3">
        <input
          value={executablePath}
          onChange={(event) => onChange(app.id, { executablePath: event.target.value })}
          className="field-input text-xs"
        />
      </td>
      <td className="p-3">
        <input
          value={category}
          onChange={(event) => onChange(app.id, { category: event.target.value })}
          className="field-input"
        />
      </td>
      <td className="p-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void onSave(app.id);
            }}
            className="primary-button px-3 py-2 text-xs"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              void onDelete(app.id);
            }}
            className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger/15"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
};

export const Admin = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clearSession = useAuthStore((state) => state.clearSession);
  const setMustChangePin = useAuthStore((state) => state.setMustChangePin);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<AppEntry>>>({});
  const [orderedApps, setOrderedApps] = useState<AppEntry[]>([]);
  const [scanResults, setScanResults] = useState<AppEntry[]>([]);
  const [pinForm, setPinForm] = useState({ currentPin: "", newPin: "", confirmPin: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 10 } }));

  const appsQuery = useQuery({
    queryKey: ADMIN_APPS_QUERY_KEY,
    queryFn: async () => {
      const response = await api.get<AppEntry[]>("/admin/apps");
      return response.data.sort((left, right) => left.sortOrder - right.sortOrder);
    },
  });

  useEffect(() => {
    if (appsQuery.data) {
      setOrderedApps(appsQuery.data);
    }
  }, [appsQuery.data]);

  const createMutation = useMutation({
    mutationFn: async (payload: AddAppPayload) => {
      const response = await api.post<AppEntry>("/admin/apps", payload);
      return response.data;
    },
    onSuccess: async (app) => {
      await queryClient.invalidateQueries({ queryKey: ADMIN_APPS_QUERY_KEY });
      setIsModalOpen(false);
      setMessage(`Saved ${app.name}.`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<AppEntry> }) => {
      const response = await api.put<AppEntry>(`/admin/apps/${id}`, patch);
      return response.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ADMIN_APPS_QUERY_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/apps/${id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ADMIN_APPS_QUERY_KEY });
      setMessage("Application removed.");
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<AppEntry[]>("/admin/apps/scan");
      return response.data;
    },
    onSuccess: (data) => {
      setScanResults(data);
      setMessage(`Found ${data.length} scan candidate${data.length === 1 ? "" : "s"}.`);
    },
  });

  const pickExecutableMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<AppDraft>("/admin/apps/pick-executable");
      return response.data;
    },
  });

  const changePinMutation = useMutation({
    mutationFn: async () => {
      await api.post("/auth/change-pin", pinForm);
    },
    onSuccess: () => {
      setPinForm({ currentPin: "", newPin: "", confirmPin: "" });
      setMustChangePin(false);
      setMessage("PIN updated successfully.");
    },
  });

  const isForbidden = useMemo(() => {
    const errorResponse = appsQuery.error as AxiosError<ApiErrorResponse> | null;
    return errorResponse?.response?.status === 403;
  }, [appsQuery.error]);

  const totalCategories = useMemo(
    () => new Set(orderedApps.map((app) => app.category).filter(Boolean)).size,
    [orderedApps],
  );

  const availableScanResults = useMemo(() => {
    const existingKeys = new Set(
      orderedApps.map((app) => `${app.platform}:${app.executablePath.trim().toLowerCase()}`),
    );

    return scanResults.filter((app) => !existingKeys.has(`${app.platform}:${app.executablePath.trim().toLowerCase()}`));
  }, [orderedApps, scanResults]);

  const handleLogout = () => {
    clearSession();
    navigate("/pin", { replace: true });
  };

  const extractErrorMessage = (rawError: unknown, fallback: string) => {
    const errorResponse = rawError as AxiosError<ApiErrorResponse>;
    return errorResponse.response?.data?.message ?? fallback;
  };

  const updateDraft = (id: string, patch: Partial<AppEntry>) => {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...patch,
      },
    }));
  };

  const saveDraft = async (id: string) => {
    const draft = drafts[id];

    if (!draft) {
      return;
    }

    setError("");

    try {
      await updateMutation.mutateAsync({ id, patch: draft });
      setDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setMessage("Changes saved.");
    } catch (rawError) {
      setError(extractErrorMessage(rawError, "Failed to save the application."));
    }
  };

  const deleteApp = async (id: string) => {
    setError("");

    try {
      await deleteMutation.mutateAsync(id);
    } catch (rawError) {
      setError(extractErrorMessage(rawError, "Failed to delete the application."));
    }
  };

  const persistSortOrder = async (apps: AppEntry[]) => {
    for (let index = 0; index < apps.length; index += 1) {
      const app = apps[index];

      if (app.sortOrder === index) {
        continue;
      }

      await updateMutation.mutateAsync({ id: app.id, patch: { sortOrder: index } });
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    setOrderedApps((current) => {
      const oldIndex = current.findIndex((app) => app.id === active.id);
      const newIndex = current.findIndex((app) => app.id === over.id);

      if (oldIndex === -1 || newIndex === -1) {
        return current;
      }

      const moved = arrayMove(current, oldIndex, newIndex).map((app, index) => ({
        ...app,
        sortOrder: index,
      }));

      void persistSortOrder(moved).catch(() => {
        setError("Failed to save the new application order.");
      });

      return moved;
    });
  };

  const submitAddApp = async (payload: AddAppPayload) => {
    setError("");
    setMessage("");

    try {
      await createMutation.mutateAsync(payload);
    } catch (rawError) {
      setError(extractErrorMessage(rawError, "Failed to add the application."));
    }
  };

  const pickExecutable = async () => {
    setError("");
    setMessage("");

    try {
      return await pickExecutableMutation.mutateAsync();
    } catch (rawError) {
      setError(extractErrorMessage(rawError, "Failed to open the system file picker."));
      throw rawError;
    }
  };

  const quickAdd = async () => {
    setError("");
    setMessage("");

    try {
      const draft = await pickExecutable();
      await createMutation.mutateAsync({
        name: draft.name,
        icon: draft.icon ?? "",
        executablePath: draft.executablePath,
        args: draft.args,
        workingDirectory: draft.workingDirectory,
        category: draft.category,
        platform: draft.platform,
      });
    } catch {
      // Error is already handled in pickExecutable / create mutation.
    }
  };

  const applyScannedApp = async (app: AppEntry) => {
    await submitAddApp({
      name: app.name,
      executablePath: app.executablePath,
      icon: app.icon,
      args: app.args,
      workingDirectory: app.workingDirectory,
      category: app.category,
      platform: app.platform,
    });

    setScanResults((current) => current.filter((entry) => entry.id !== app.id));
  };

  const submitPinChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    try {
      await changePinMutation.mutateAsync();
    } catch (rawError) {
      setError(extractErrorMessage(rawError, "Failed to update the PIN."));
    }
  };

  if (isForbidden) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 text-center">
        <h1 className="text-3xl font-semibold text-white">403 — Localhost only</h1>
        <p className="mt-3 text-white/65">The Admin page can only be opened from the host machine itself (127.0.0.1 / ::1).</p>
        <button type="button" onClick={handleLogout} className="secondary-button mx-auto mt-6">
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-7xl px-4 pb-10 pt-4">
      <header className="glass-panel mb-5 rounded-[30px] p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-accentSoft/80">Local administration</p>
            <h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">Production-ready app management</h1>
            <p className="mt-3 text-sm leading-6 text-white/65">
              Curate your launcher, scan meaningful desktop shortcuts, reorder apps with drag and drop, and rotate the security PIN — all from the local admin console.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="primary-button" onClick={() => void quickAdd()} disabled={pickExecutableMutation.isPending || createMutation.isPending}>
              {pickExecutableMutation.isPending ? "Opening picker..." : "Quick add app"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setIsModalOpen(true)}>
              Advanced add
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void scanMutation.mutateAsync();
              }}
              disabled={scanMutation.isPending}
            >
              {scanMutation.isPending ? "Scanning..." : "Scan installed apps"}
            </button>
            <button type="button" className="secondary-button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Managed apps</p>
            <p className="mt-2 text-3xl font-semibold text-white">{orderedApps.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Categories</p>
            <p className="mt-2 text-3xl font-semibold text-white">{totalCategories}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Scan results</p>
            <p className="mt-2 text-3xl font-semibold text-white">{availableScanResults.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Security</p>
            <p className="mt-2 text-sm font-medium text-accentSoft">Admin is locked to localhost</p>
          </div>
        </div>
      </header>

      {error && <p className="mb-4 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
      {message && <p className="mb-4 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm text-accentSoft">{message}</p>}

      <section className="glass-panel mb-6 overflow-hidden rounded-[30px] p-0">
        <div className="border-b border-white/8 px-5 py-4">
          <h2 className="text-xl font-semibold text-white">Launcher inventory</h2>
          <p className="mt-1 text-sm text-white/60">Edit titles, executable paths, categories, and reorder the cards shown on the dashboard.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-[0.2em] text-white/45">
              <tr>
                <th className="p-3">Move</th>
                <th className="p-3">#</th>
                <th className="p-3">Name</th>
                <th className="p-3">Executable path</th>
                <th className="p-3">Category</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={orderedApps.map((app) => app.id)} strategy={verticalListSortingStrategy}>
                  {orderedApps.map((app) => (
                    <SortableRow
                      key={app.id}
                      app={app}
                      draft={drafts[app.id]}
                      onChange={updateDraft}
                      onSave={saveDraft}
                      onDelete={deleteApp}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </tbody>
          </table>
        </div>
      </section>

      {availableScanResults.length > 0 && (
        <section className="glass-panel mb-6 rounded-[30px] p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Suggested applications</h2>
              <p className="mt-1 text-sm text-white/60">
                Windows scans prioritize desktop and Start Menu shortcuts while filtering common uninstallers, helpers, and setup tools.
              </p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/55">
              Showing top {Math.min(availableScanResults.length, 24)} results
            </span>
          </div>

          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {availableScanResults.slice(0, 24).map((app) => (
              <li key={app.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-base font-semibold text-white">{app.name}</p>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-white/55">{app.executablePath}</p>
                {app.category && (
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-accentSoft/80">{app.category}</p>
                )}
                <button
                  type="button"
                  className="primary-button mt-4 w-full justify-center"
                  onClick={() => {
                    void applyScannedApp(app);
                  }}
                >
                  Add to launcher
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="glass-panel rounded-[30px] p-5">
        <h2 className="text-xl font-semibold text-white">Security settings</h2>
        <p className="mt-1 text-sm text-white/60">Change the launcher PIN used to unlock the mobile dashboard.</p>

        <form onSubmit={submitPinChange} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            value={pinForm.currentPin}
            onChange={(event) => setPinForm((current) => ({ ...current, currentPin: event.target.value }))}
            placeholder="Current PIN"
            className="field-input"
            inputMode="numeric"
            pattern="[0-9]{4,8}"
            required
          />
          <input
            value={pinForm.newPin}
            onChange={(event) => setPinForm((current) => ({ ...current, newPin: event.target.value }))}
            placeholder="New PIN"
            className="field-input"
            inputMode="numeric"
            pattern="[0-9]{4,8}"
            required
          />
          <input
            value={pinForm.confirmPin}
            onChange={(event) => setPinForm((current) => ({ ...current, confirmPin: event.target.value }))}
            placeholder="Confirm PIN"
            className="field-input"
            inputMode="numeric"
            pattern="[0-9]{4,8}"
            required
          />
          <button type="submit" className="primary-button justify-center sm:col-span-3" disabled={changePinMutation.isPending}>
            {changePinMutation.isPending ? "Saving..." : "Update PIN"}
          </button>
        </form>
      </section>

      <AddAppModal
        isOpen={isModalOpen}
        isSubmitting={createMutation.isPending}
        isPickingExecutable={pickExecutableMutation.isPending}
        onClose={() => setIsModalOpen(false)}
        onSubmit={submitAddApp}
        onPickExecutable={pickExecutable}
      />

      {appsQuery.isLoading && <p className="mt-4 text-sm text-white/70">Loading applications...</p>}
    </div>
  );
};
