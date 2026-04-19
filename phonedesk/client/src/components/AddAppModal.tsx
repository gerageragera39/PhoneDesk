import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import type { AppDraft, AppPlatform } from "../types";

export type AddAppPayload = AppDraft;

interface AddAppModalProps {
  isOpen: boolean;
  isSubmitting: boolean;
  isPickingExecutable: boolean;
  onClose: () => void;
  onSubmit: (payload: AddAppPayload) => Promise<void>;
  onPickExecutable: () => Promise<Partial<AddAppPayload>>;
}

const MAX_ICON_BYTES = 64 * 1024;

export const AddAppModal = ({
  isOpen,
  isSubmitting,
  isPickingExecutable,
  onClose,
  onSubmit,
  onPickExecutable,
}: AddAppModalProps) => {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [executablePath, setExecutablePath] = useState("");
  const [argsLine, setArgsLine] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [category, setCategory] = useState("");
  const [platform, setPlatform] = useState<AppPlatform>("both");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState("");

  const isValid = useMemo(() => name.trim().length > 0 && executablePath.trim().length > 0, [name, executablePath]);

  if (!isOpen) {
    return null;
  }

  const reset = () => {
    setName("");
    setIcon("");
    setExecutablePath("");
    setArgsLine("");
    setWorkingDirectory("");
    setCategory("");
    setPlatform("both");
    setShowAdvanced(false);
    setError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const applyDraft = (draft: Partial<AddAppPayload>) => {
    if (draft.name) {
      setName(draft.name);
    }

    if (draft.icon !== undefined) {
      setIcon(draft.icon);
    }

    if (draft.executablePath) {
      setExecutablePath(draft.executablePath);
    }

    if (draft.workingDirectory) {
      setWorkingDirectory(draft.workingDirectory);
    }

    if (draft.category) {
      setCategory(draft.category);
    }

    if (draft.platform) {
      setPlatform(draft.platform);
    }

    if (draft.args?.length) {
      setArgsLine(draft.args.join(" "));
    }

    setError("");
  };

  const handlePickExecutable = async () => {
    try {
      const draft = await onPickExecutable();
      applyDraft(draft);
    } catch {
      // The parent already shows a readable error banner.
    }
  };

  const handleIconUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (file.size > MAX_ICON_BYTES) {
      setError("The icon is too large. Maximum size is 64 KB.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        setIcon(reader.result);
        setError("");
      }
    };

    reader.readAsDataURL(file);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isValid) {
      setError("Please provide both the app name and the executable path.");
      return;
    }

    const args = argsLine
      .split(" ")
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0);

    await onSubmit({
      name: name.trim(),
      icon,
      executablePath: executablePath.trim(),
      args: args.length > 0 ? args : undefined,
      workingDirectory: workingDirectory.trim() || undefined,
      category: category.trim() || undefined,
      platform,
    });

    reset();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
      <form onSubmit={submit} className="glass-panel w-full max-w-2xl rounded-3xl p-6 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-accentSoft/80">Advanced setup</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Add a custom application</h2>
            <p className="mt-1 text-sm text-white/60">
              Use the native file picker to auto-fill the most important fields, then optionally fine-tune the entry.
            </p>
          </div>
          <button type="button" onClick={handleClose} className="secondary-button">
            Close
          </button>
        </div>

        <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-white">Fastest workflow</p>
              <p className="text-sm text-white/60">Click the button below and choose the executable from your computer.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                void handlePickExecutable();
              }}
              className="primary-button"
              disabled={isPickingExecutable}
            >
              {isPickingExecutable ? "Opening picker..." : "Browse host files"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="field-label md:col-span-1">
            <span>Application name</span>
            <input
              className="field-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="VS Code"
              required
            />
          </label>

          <label className="field-label md:col-span-1">
            <span>Category</span>
            <input
              className="field-input"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Development"
            />
          </label>

          <label className="field-label md:col-span-2">
            <span>Executable path</span>
            <input
              className="field-input"
              value={executablePath}
              onChange={(event) => setExecutablePath(event.target.value)}
              placeholder="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
              required
            />
          </label>
        </div>

        <button
          type="button"
          className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-accentSoft hover:text-white"
          onClick={() => setShowAdvanced((value) => !value)}
        >
          <span>{showAdvanced ? "Hide" : "Show"} advanced options</span>
          <span aria-hidden="true">{showAdvanced ? "−" : "+"}</span>
        </button>

        {showAdvanced && (
          <div className="mt-4 grid grid-cols-1 gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 md:grid-cols-2">
            <label className="field-label md:col-span-2">
              <span>Launch arguments</span>
              <input
                className="field-input"
                value={argsLine}
                onChange={(event) => setArgsLine(event.target.value)}
                placeholder="--profile-directory Default"
              />
            </label>

            <label className="field-label md:col-span-2">
              <span>Working directory</span>
              <input
                className="field-input"
                value={workingDirectory}
                onChange={(event) => setWorkingDirectory(event.target.value)}
                placeholder="C:\\Program Files\\Google\\Chrome\\Application"
              />
            </label>

            <label className="field-label">
              <span>Platform</span>
              <select className="field-input" value={platform} onChange={(event) => setPlatform(event.target.value as AppPlatform)}>
                <option value="both">Both</option>
                <option value="windows">Windows</option>
                <option value="linux">Linux</option>
              </select>
            </label>

            <label className="field-label">
              <span>Icon URL or Data URL</span>
              <input
                className="field-input"
                value={icon}
                onChange={(event) => setIcon(event.target.value)}
                placeholder="https://... or data:image/..."
              />
            </label>

            <label className="field-label md:col-span-2">
              <span>Upload icon (PNG/JPEG, up to 64 KB)</span>
              <input type="file" accept="image/png,image/jpeg" onChange={handleIconUpload} className="text-sm text-white/70 file:mr-3 file:rounded-xl file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white" />
            </label>
          </div>
        )}

        {error && <p className="mt-4 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" onClick={handleClose} className="secondary-button">
            Cancel
          </button>
          <button type="submit" disabled={!isValid || isSubmitting} className="primary-button disabled:cursor-not-allowed disabled:opacity-60">
            {isSubmitting ? "Saving..." : "Save application"}
          </button>
        </div>
      </form>
    </div>
  );
};
