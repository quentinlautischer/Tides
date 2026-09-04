import iNaturalistMark from '../assets/inaturalist.png';

/**
 * The iNaturalist mark: their green bird, taken from the favicon their site serves at
 * https://www.inaturalist.org/favicon.ico. It stands for the source the sighting lookup
 * queries, so it is their asset rather than a drawing of it.
 *
 * Bundled rather than hotlinked, rather than a stand-in drawn in SVG as it was before:
 * hotlinking would put a request to another origin in the render path and break the button
 * whenever they move the file. The favicon only comes in 32px, which is exactly the pixels a
 * 2x display wants for the 16px this renders at, so it is used at its native size.
 */
export default function INaturalistIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <img src={iNaturalistMark} alt="" aria-hidden="true" className={className} />;
}
