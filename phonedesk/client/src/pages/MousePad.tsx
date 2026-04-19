import type { AxiosError } from "axios";
import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { Link } from "react-router-dom";
import { mouseApi } from "../services/api";
import type { ApiErrorResponse } from "../types";

const SEND_INTERVAL_MS = 18;
const MOVE_SENSITIVITY = 3.1;
const SCROLL_SENSITIVITY = 0.7;
const DOUBLE_TAP_INTERVAL_MS = 280;
const TAP_DURATION_MS = 220;
const TAP_MOVE_TOLERANCE_PX = 14;
const DOUBLE_TAP_DISTANCE_PX = 28;

interface Point {
  x: number;
  y: number;
}

export const MousePad = () => {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("One finger moves the pointer · two fingers scroll · double tap for left click");

  const singleTouchRef = useRef<Point | null>(null);
  const twoFingerCenterRef = useRef<Point | null>(null);
  const tapStartRef = useRef<{ point: Point; time: number; moved: boolean } | null>(null);
  const lastTapRef = useRef<{ point: Point; time: number } | null>(null);
  const statusResetTimerRef = useRef<number | null>(null);

  const moveTimerRef = useRef<number | null>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const lastMoveSentAtRef = useRef(0);
  const lastScrollSentAtRef = useRef(0);
  const pendingMoveRef = useRef({ dx: 0, dy: 0 });
  const pendingScrollRef = useRef(0);

  const flashStatus = useCallback((value: string) => {
    setStatus(value);

    if (statusResetTimerRef.current !== null) {
      window.clearTimeout(statusResetTimerRef.current);
    }

    statusResetTimerRef.current = window.setTimeout(() => {
      setStatus("One finger moves the pointer · two fingers scroll · double tap for left click");
    }, 1600);
  }, []);

  const flushMove = useCallback(() => {
    moveTimerRef.current = null;

    const dx = Math.round(pendingMoveRef.current.dx * MOVE_SENSITIVITY);
    const dy = Math.round(pendingMoveRef.current.dy * MOVE_SENSITIVITY);
    pendingMoveRef.current = { dx: 0, dy: 0 };

    if (dx === 0 && dy === 0) {
      return;
    }

    lastMoveSentAtRef.current = Date.now();

    void mouseApi.move(dx, dy).catch((rawError: AxiosError<ApiErrorResponse>) => {
      setError(rawError.response?.data?.message ?? "Failed to move the cursor.");
    });
  }, []);

  const flushScroll = useCallback(() => {
    scrollTimerRef.current = null;

    const dy = Math.round(pendingScrollRef.current * SCROLL_SENSITIVITY);
    pendingScrollRef.current = 0;

    if (dy === 0) {
      return;
    }

    lastScrollSentAtRef.current = Date.now();

    void mouseApi.scroll(dy).catch((rawError: AxiosError<ApiErrorResponse>) => {
      setError(rawError.response?.data?.message ?? "Failed to send the scroll gesture.");
    });
  }, []);

  const queueMove = useCallback(
    (dx: number, dy: number) => {
      pendingMoveRef.current.dx += dx;
      pendingMoveRef.current.dy += dy;

      if (moveTimerRef.current !== null) {
        return;
      }

      const elapsed = Date.now() - lastMoveSentAtRef.current;
      moveTimerRef.current = window.setTimeout(flushMove, Math.max(0, SEND_INTERVAL_MS - elapsed));
    },
    [flushMove],
  );

  const queueScroll = useCallback(
    (dy: number) => {
      pendingScrollRef.current += dy;

      if (scrollTimerRef.current !== null) {
        return;
      }

      const elapsed = Date.now() - lastScrollSentAtRef.current;
      scrollTimerRef.current = window.setTimeout(flushScroll, Math.max(0, SEND_INTERVAL_MS - elapsed));
    },
    [flushScroll],
  );

  useEffect(() => {
    return () => {
      if (moveTimerRef.current !== null) {
        window.clearTimeout(moveTimerRef.current);
      }

      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }

      if (statusResetTimerRef.current !== null) {
        window.clearTimeout(statusResetTimerRef.current);
      }
    };
  }, []);

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    setError("");

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      singleTouchRef.current = { x: touch.clientX, y: touch.clientY };
      twoFingerCenterRef.current = null;
      tapStartRef.current = {
        point: { x: touch.clientX, y: touch.clientY },
        time: Date.now(),
        moved: false,
      };
      return;
    }

    if (event.touches.length === 2) {
      const [first, second] = [event.touches[0], event.touches[1]];
      twoFingerCenterRef.current = {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      };
      singleTouchRef.current = null;
      tapStartRef.current = null;
    }
  };

  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      const previous = singleTouchRef.current;

      if (!previous) {
        singleTouchRef.current = { x: touch.clientX, y: touch.clientY };
        return;
      }

      queueMove(touch.clientX - previous.x, touch.clientY - previous.y);

      if (tapStartRef.current) {
        const movedX = Math.abs(touch.clientX - tapStartRef.current.point.x);
        const movedY = Math.abs(touch.clientY - tapStartRef.current.point.y);

        if (movedX > TAP_MOVE_TOLERANCE_PX || movedY > TAP_MOVE_TOLERANCE_PX) {
          tapStartRef.current.moved = true;
        }
      }

      singleTouchRef.current = { x: touch.clientX, y: touch.clientY };
      return;
    }

    if (event.touches.length === 2) {
      const [first, second] = [event.touches[0], event.touches[1]];
      const center = {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      };

      const previousCenter = twoFingerCenterRef.current;
      if (previousCenter) {
        queueScroll(center.y - previousCenter.y);
      }

      twoFingerCenterRef.current = center;
      singleTouchRef.current = null;
      tapStartRef.current = null;
    }
  };

  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 0 && tapStartRef.current) {
      const finishedTap = tapStartRef.current;
      tapStartRef.current = null;

      const duration = Date.now() - finishedTap.time;
      const isTap = !finishedTap.moved && duration <= TAP_DURATION_MS;

      if (isTap) {
        const previousTap = lastTapRef.current;
        const now = Date.now();

        if (
          previousTap &&
          now - previousTap.time <= DOUBLE_TAP_INTERVAL_MS &&
          Math.abs(previousTap.point.x - finishedTap.point.x) <= DOUBLE_TAP_DISTANCE_PX &&
          Math.abs(previousTap.point.y - finishedTap.point.y) <= DOUBLE_TAP_DISTANCE_PX
        ) {
          void handleClick("left");
          lastTapRef.current = null;
        } else {
          lastTapRef.current = { point: finishedTap.point, time: now };
        }
      } else {
        lastTapRef.current = null;
      }
    }

    singleTouchRef.current = null;
    twoFingerCenterRef.current = null;
  };

  const handleClick = async (button: "left" | "right") => {
    setError("");

    if (navigator.vibrate) {
      navigator.vibrate(28);
    }

    try {
      await mouseApi.click(button);
      flashStatus(button === "left" ? "Left click sent" : "Right click sent");
    } catch (rawError) {
      const errorResponse = rawError as AxiosError<ApiErrorResponse>;
      setError(errorResponse.response?.data?.message ?? "Failed to send the click action.");
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-5 pt-4">
      <header className="glass-panel mb-4 rounded-[28px] p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accentSoft/80">Remote mouse</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">High-speed trackpad mode</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">{status}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link to="/dashboard" className="secondary-button">
              Applications
            </Link>
            <Link to="/admin" className="secondary-button">
              Admin
            </Link>
          </div>
        </div>
      </header>

      {error && <p className="mb-4 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">One finger: move the cursor</div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">Two fingers: scroll vertically</div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">Double tap or button bar: click</div>
      </section>

      <section
        className="relative flex-[9] touch-none overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/80"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(18,196,139,0.12),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.16),transparent_30%)]" />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.34em] text-white/25">Precision surface</span>
          <span className="mt-3 text-2xl font-semibold text-white/20">Trackpad</span>
        </div>
      </section>

      <section className="mt-4 grid flex-[1] grid-cols-2 overflow-hidden rounded-[28px] border border-white/10 bg-slate-900/80">
        <button
          type="button"
          className="h-full min-h-[84px] border-r border-white/10 text-lg font-semibold text-white transition active:bg-white/10"
          onClick={() => {
            void handleClick("left");
          }}
        >
          Left click
        </button>
        <button
          type="button"
          className="h-full min-h-[84px] text-lg font-semibold text-white transition active:bg-white/10"
          onClick={() => {
            void handleClick("right");
          }}
        >
          Right click
        </button>
      </section>
    </div>
  );
};
