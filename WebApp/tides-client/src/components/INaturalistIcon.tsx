/**
 * A stand-in for the iNaturalist mark: their green roundel with a white bird on it.
 * Drawn inline rather than fetched so it needs no network round trip and inherits the
 * button's sizing; it is an approximation of the real logo, not the asset itself.
 */
export default function INaturalistIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#74AC00" />
      <circle cx="14.2" cy="8.8" r="2.9" fill="#ffffff" />
      <path d="M19.6 8.5 L16.4 7.4 L16.4 10.3 Z" fill="#ffffff" />
      <path
        fill="#ffffff"
        d="M13.2 10.9C9.6 11.9 7 14.6 6.3 17.8c-.1.6.6 1 1.1.6 3.2-2 6.6-3.1 8.9-5.3 1.5-1.4.6-2.9-1-3z"
      />
      <circle cx="15.1" cy="8.4" r=".85" fill="#74AC00" />
    </svg>
  );
}
