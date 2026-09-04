import { useEffect, useState } from 'react';

/**
 * What the app says while it waits. Written in the voice of someone actually out on the rocks,
 * since a tide lookup is usually over in well under a second and a progress report would be
 * both duller and less honest than this.
 */
const MESSAGES = [
  'Finding tides…',
  'Checking under the rocks…',
  'Counting barnacles…',
  'Negotiating with a crab…',
  'Startling a sculpin…',
  'Following a nudibranch…',
  'Untangling the bull kelp…',
  'Sounding the depths…',
  'Chasing the low…',
  'Tracking the ebb…',
  'Asking the moon…',
  'Consulting the almanac…',
  'Squinting at the horizon…',
];

/** Long enough to be read, short enough that a slow load doesn't sit on one line. */
const ROTATE_MS = 3000;

function pick(previous?: string): string {
  // Never twice in a row: a repeat reads as the animation having stalled.
  const choices = previous ? MESSAGES.filter((m) => m !== previous) : MESSAGES;
  return choices[Math.floor(Math.random() * choices.length)];
}

/**
 * A line to show while `active` is true, rotating if the wait goes on. A new line is drawn each
 * time a load starts, so the common case - one quick fetch - shows exactly one and never flickers.
 */
export function useLoadingMessage(active: boolean): string {
  const [message, setMessage] = useState(() => pick());
  const [wasActive, setWasActive] = useState(active);

  // Adjusted during render rather than from an effect: a fresh load wants a fresh line, and
  // that is a correction to state the render already knows is wrong, not a side effect. React
  // re-runs the render immediately, so the stale line is never painted.
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setMessage((previous) => pick(previous));
  }

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setMessage((previous) => pick(previous)), ROTATE_MS);
    return () => clearInterval(timer);
  }, [active]);

  return message;
}
