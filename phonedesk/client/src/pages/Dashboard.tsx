import type { AxiosError } from "axios";
import { useMemo, useRef, useState, type TouchEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppGrid } from "../components/AppGrid";
import { useApps } from "../hooks/useApps";
import { useAuthStore } from "../stores/authStore";
import type { ApiErrorResponse, AppEntry } from "../types";

const PULL_THRESHOLD = 80;

export const Dashboard = () => {
  const navigate = useNavigate();
  const clearSession = useAuthStore((state) => state.clearSession);
  const mustChangePin = useAuthStore((state) => state.mustChangePin);
  const { apps, statuses, isLoading, isFetching, refetchApps, refreshStatuses, launchApp } = useApps();

  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pullDistance, setPullDistance] = useState(0);
  const [search, setSearch] = useState("");

  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);

  const pullLabel = useMemo(() => {
    if (isFetching) {
      return "Refreshing applications...";
    }

    if (pullDistance > PULL_THRESHOLD) {
      return "Release to refresh";
    }

    return "Pull down to refresh";
  }, [isFetching, pullDistance]);

  const filteredApps = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return apps;
    }

    return apps.filter((app) => {
      const haystack = `${app.name} ${app.category ?? ""} ${app.executablePath}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [apps, search]);

  const groupedApps = useMemo(() => {
    const groups = new Map<string, AppEntry[]>();

    for (const app of filteredApps) {
      const key = app.category?.trim() || "All apps";
      const current = groups.get(key) ?? [];
      current.push(app);
      groups.set(key, current);
    }

    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [filteredApps]);

  const runningCount = useMemo(
    () => filteredApps.reduce((count, app) => count + (statuses[app.id] ? 1 : 0), 0),
    [filteredApps, statuses],
  );

  const logout = () => {
    clearSession();
    navigate("/pin", { replace: true });
  };

  const handleLaunch = async (app: AppEntry) => {
    setError("");
    setLaunchingId(app.id);

    if (navigator.vibrate) {
      navigator.vibrate(18);
    }

    try {
      await launchApp(app.id);
    } catch (rawError) {
      const errorResponse = rawError as AxiosError<ApiErrorResponse>;
      setError(errorResponse.response?.data?.message ?? "Failed to launch the selected application.");
    } finally {
      setLaunchingId(null);
    }
  };

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const element = event.currentTarget;

    if (element.scrollTop > 0) {
      startYRef.current = null;
      pullingRef.current = false;
      return;
    }

    startYRef.current = event.touches[0].clientY;
    pullingRef.current = true;
  };

  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!pullingRef.current || startYRef.current === null) {
      return;
    }

    const delta = event.touches[0].clientY - startYRef.current;
    if (delta <= 0) {
      setPullDistance(0);
      return;
    }

    setPullDistance(Math.min(120, delta));
  };

  const onTouchEnd = async () => {
    if (!pullingRef.current) {
      return;
    }

    if (pullDistance > PULL_THRESHOLD) {
      refreshStatuses();
      await refetchApps();
    }

    setPullDistance(0);
    pullingRef.current = false;
    startYRef.current = null;
  };

  return (
    <div
      className="mx-auto min-h-screen w-full max-w-6xl overflow-y-auto px-4 pb-10 pt-4"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={() => {
        void onTouchEnd();
      }}
    >
      <header className="glass-panel mb-5 rounded-[28px] p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-accentSoft/80">Remote launcher</p>
            <h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">Launch your desktop apps from your phone</h1>
            <p className="mt-3 text-sm leading-6 text-white/65">
              Browse your curated app grid, focus already running windows, and keep your workstation under control from a single mobile dashboard.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[420px]">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.24em] text-white/45">Apps</p>
              <p className="mt-2 text-2xl font-semibold text-white">{filteredApps.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.24em] text-white/45">Running</p>
              <p className="mt-2 text-2xl font-semibold text-white">{runningCount}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.24em] text-white/45">Sections</p>
              <p className="mt-2 text-2xl font-semibold text-white">{groupedApps.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.24em] text-white/45">Status</p>
              <p className="mt-2 text-sm font-medium text-accentSoft">{isFetching ? "Syncing" : "Live"}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-full flex-col gap-3 sm:flex-row lg:max-w-2xl">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="field-input min-w-0 flex-1"
              placeholder="Search apps, categories, or executable paths"
            />
            {mustChangePin && (
              <div className="inline-flex items-center rounded-2xl border border-yellow-400/25 bg-yellow-400/10 px-4 py-3 text-sm text-yellow-200">
                For security, update your PIN in the Admin page.
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link to="/mouse" className="secondary-button">
              Mouse mode
            </Link>
            <Link to="/admin" className="secondary-button">
              Admin
            </Link>
            <button type="button" onClick={logout} className="secondary-button">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mb-4 h-6 text-center text-xs text-white/60" style={{ opacity: pullDistance > 0 || isFetching ? 1 : 0 }}>
        {pullLabel}
      </div>

      {error && <p className="mb-4 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      {isLoading ? (
        <div className="glass-panel rounded-[28px] p-10 text-center text-white/70">Loading your applications...</div>
      ) : filteredApps.length === 0 ? (
        <div className="glass-panel rounded-[28px] p-10 text-center">
          <h2 className="text-xl font-semibold text-white">No applications match your search</h2>
          <p className="mt-2 text-sm text-white/60">Try a different keyword or add more apps from the Admin page.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupedApps.map(([groupName, groupApps]) => (
            <section key={groupName}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-white/40">Section</p>
                  <h2 className="mt-1 text-xl font-semibold text-white">{groupName}</h2>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/55">
                  {groupApps.length} app{groupApps.length === 1 ? "" : "s"}
                </span>
              </div>
              <AppGrid apps={groupApps} statuses={statuses} disabled={Boolean(launchingId)} onLaunch={handleLaunch} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
