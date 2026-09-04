// One period is 16 wide and the path runs 48, so there is always a full period of slack to
// scroll into view on either side of the 32-wide window.
const WAVE = 'M-8 8 C-5 3 -3 3 0 8 C3 13 5 13 8 8 C11 3 13 3 16 8 C19 13 21 13 24 8 C27 3 29 3 32 8 C35 13 37 13 40 8';

/**
 * The one loading indicator: a swell rolling through, rather than a spinner. Sized by the
 * caller and drawn in `currentColor`, so it takes the colour of whatever it sits next to.
 */
export default function WaveLoader({ className = 'h-4 w-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 16" fill="none" aria-hidden="true">
      <g className="tide-wave tide-wave-back">
        <path d={WAVE} stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
      </g>
      <g className="tide-wave">
        <path d={WAVE} stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
      </g>
    </svg>
  );
}
