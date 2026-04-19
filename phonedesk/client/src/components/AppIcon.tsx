import { motion } from "framer-motion";
import type { AppEntry } from "../types";

interface AppIconProps {
  app: AppEntry;
  isRunning: boolean;
  disabled?: boolean;
  onPress: (app: AppEntry) => void;
}

const hasImageIcon = (icon: string): boolean => {
  if (icon.startsWith("data:image") || icon.startsWith("http://") || icon.startsWith("https://")) {
    return true;
  }

  if (!icon.startsWith("/")) {
    return false;
  }

  const lower = icon.toLowerCase();
  const isFilesystemPath =
    lower.startsWith("/usr/") ||
    lower.startsWith("/home/") ||
    lower.startsWith("/opt/") ||
    lower.startsWith("/var/") ||
    lower.startsWith("/snap/") ||
    lower.startsWith("/etc/");

  return !isFilesystemPath;
};

const buildFallbackLabel = (name: string): string => {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};

const buildGradient = (name: string): string => {
  const gradients = [
    "from-cyan-400/30 via-blue-500/20 to-purple-500/30",
    "from-emerald-400/30 via-teal-500/20 to-cyan-500/30",
    "from-fuchsia-400/30 via-violet-500/20 to-blue-500/30",
    "from-orange-400/30 via-rose-500/20 to-fuchsia-500/30",
    "from-yellow-400/30 via-amber-500/20 to-orange-500/30",
  ];

  const hash = Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0);
  return gradients[hash % gradients.length];
};

export const AppIcon = ({ app, isRunning, disabled = false, onPress }: AppIconProps) => {
  const fallbackLabel = buildFallbackLabel(app.name);
  const gradient = buildGradient(app.name);

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      className="group relative flex h-full min-h-[156px] w-full flex-col items-start justify-between overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-accent/60 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-55"
      onClick={() => onPress(app)}
      disabled={disabled}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 transition duration-300 group-hover:opacity-100`} />
      <div className="relative flex w-full items-start justify-between gap-3">
        <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-base/80 text-base font-semibold text-white shadow-lg shadow-black/30">
          {hasImageIcon(app.icon) ? (
            <img src={app.icon} alt={app.name} className="h-full w-full object-cover" />
          ) : (
            <span>{fallbackLabel}</span>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            isRunning
              ? "border-accent/40 bg-accent/15 text-accentSoft"
              : "border-white/10 bg-white/5 text-white/50"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${isRunning ? "bg-accent" : "bg-white/30"}`} />
          {isRunning ? "Running" : "Idle"}
        </span>
      </div>

      <div className="relative w-full">
        {app.category && (
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">{app.category}</p>
        )}
        <p className="line-clamp-2 text-base font-semibold text-white">{app.name}</p>
        <p className="mt-2 text-xs text-white/45">Tap to focus or launch</p>
      </div>
    </motion.button>
  );
};
