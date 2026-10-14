import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ListEnd, Moon, TimerOff } from "lucide-react";
import { t } from "../../i18n";
import {
  formatSleepRemaining,
  sleepTimerRemainingMs,
  SLEEP_TIMER_PRESET_MINUTES,
} from "../../lib/sleepTimer";
import { selectSleepTimerActive, useSleepTimerStore } from "../../stores";
import { Popover, PopoverDivider, PopoverHeader, PopoverItem } from "../ui/Popover";

const CheckSlot = ({ checked }: { checked: boolean }) => (
  <Check className={`h-4 w-4 shrink-0 ${checked ? "opacity-80" : "opacity-0"}`} />
);

// Player-bar sleep timer: timed presets, end of track, stop after this track.
export const SleepTimerMenu = () => {
  const endsAt = useSleepTimerStore((state) => state.endsAt);
  const minutes = useSleepTimerStore((state) => state.minutes);
  const isFading = useSleepTimerStore((state) => state.isFading);
  const stopAfterCurrent = useSleepTimerStore((state) => state.stopAfterCurrent);
  const active = useSleepTimerStore(selectSleepTimerActive);
  const startTimer = useSleepTimerStore((state) => state.startTimer);
  const sleepAtEndOfTrack = useSleepTimerStore((state) => state.sleepAtEndOfTrack);
  const toggleStopAfterCurrent = useSleepTimerStore((state) => state.toggleStopAfterCurrent);
  const cancelAll = useSleepTimerStore((state) => state.cancelAll);

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // The popover closes itself on any outside pointerdown, the trigger
  // included; the click that follows must not reopen it. A window capture
  // listener runs before the popover's document listener closes it.
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!position) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      suppressClickRef.current = target instanceof Node && !!buttonRef.current?.contains(target);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [position]);

  // Tick once a second while a countdown runs (shown in the tooltip and menu).
  useEffect(() => {
    if (endsAt === null) return;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [endsAt]);

  const close = useCallback(() => setPosition(null), []);
  const choose = (action: () => void) => {
    action();
    close();
  };

  // `now` is stale until the first tick after a timer starts; capping at the
  // preset length keeps that first second from showing too much time.
  const remainingMs =
    endsAt !== null
      ? Math.min(sleepTimerRemainingMs(endsAt, now), (minutes ?? Infinity) * 60_000)
      : 0;
  const remaining = formatSleepRemaining(remainingMs);
  const status = isFading
    ? t("player.sleep.fading")
    : endsAt !== null
      ? t("player.sleep.remaining", { time: remaining })
      : stopAfterCurrent
        ? t("player.sleep.stopsAfterTrack")
        : null;
  const buttonTitle = status
    ? t("player.sleep.tooltipActive", { status })
    : t("player.sleep.tooltip");

  return (
    <>
      <button
        ref={buttonRef}
        className={`player-bar-button flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] ${active ? "text-[var(--color-accent)]" : "text-[var(--color-text-secondary)]"}`}
        onClick={(event) => {
          if (suppressClickRef.current || position) {
            suppressClickRef.current = false;
            close();
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({ x: rect.right, y: rect.top - 8 });
        }}
        title={buttonTitle}
        aria-label={buttonTitle}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        type="button"
        data-sleep-timer-button
        data-sleep-timer-active={active ? "true" : "false"}
        data-sleep-stop-after={stopAfterCurrent ? "true" : "false"}
      >
        <Moon className="h-4 w-4" fill={active ? "currentColor" : "none"} />
      </button>
      <Popover
        isOpen={position !== null}
        position={position ?? { x: 0, y: 0 }}
        className="w-60 py-1"
        onClose={close}
      >
        <div role="menu" aria-label={t("player.sleep.tooltip")} data-sleep-timer-menu>
          <div className="pt-1">
            <PopoverHeader>{status ?? t("player.sleep.tooltip")}</PopoverHeader>
          </div>
          {SLEEP_TIMER_PRESET_MINUTES.map((preset) => (
            <PopoverItem
              key={preset}
              onClick={() => choose(() => startTimer(preset))}
              role="menuitemradio"
              aria-checked={endsAt !== null && minutes === preset}
              data-sleep-preset={preset}
            >
              <CheckSlot checked={endsAt !== null && minutes === preset} />
              {t("player.sleep.minutes", { minutes: String(preset) })}
            </PopoverItem>
          ))}
          <PopoverItem
            onClick={() => choose(sleepAtEndOfTrack)}
            role="menuitemradio"
            aria-checked={endsAt === null && stopAfterCurrent}
            data-sleep-end-of-track
          >
            <CheckSlot checked={endsAt === null && stopAfterCurrent} />
            {t("player.sleep.endOfTrack")}
          </PopoverItem>
          <PopoverDivider />
          <PopoverItem
            onClick={() => choose(toggleStopAfterCurrent)}
            role="menuitemcheckbox"
            aria-checked={stopAfterCurrent}
            data-sleep-stop-after-toggle
          >
            <ListEnd
              className={`h-4 w-4 shrink-0 ${stopAfterCurrent ? "text-[var(--color-accent)]" : "opacity-60"}`}
            />
            <span className="flex-1">{t("player.sleep.stopAfterTrack")}</span>
            {stopAfterCurrent && <Check className="h-4 w-4 shrink-0 opacity-80" />}
          </PopoverItem>
          {active && (
            <>
              <PopoverDivider />
              <PopoverItem
                onClick={() => choose(cancelAll)}
                role="menuitem"
                variant="danger"
                data-sleep-cancel
              >
                <TimerOff className="h-4 w-4 shrink-0" />
                {t("player.sleep.cancel")}
              </PopoverItem>
            </>
          )}
        </div>
      </Popover>
    </>
  );
};
