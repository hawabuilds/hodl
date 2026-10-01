import type {HomeBannerSlide} from "./homeBannerSlides";

/**
 * The small picture on the right of each banner slide. Drawn rather than
 * loaded, in white on the banner's purple, so it is sharp at any size and
 * costs no request.
 */
export function HomeBannerArt({art}: {art: HomeBannerSlide["art"]}) {
  if (art === "launch") {
    return (
      <svg viewBox="0 0 72 72" aria-hidden="true" className="h-[68px] w-[68px]">
        <circle cx="36" cy="36" r="34" fill="white" fillOpacity="0.12" />
        <path d="M36 12c9 6 13 16 11 28l-5 6H30l-5-6c-2-12 2-22 11-28z" fill="white" />
        <circle cx="36" cy="29" r="5" fill="#6860FF" />
        <path d="M25 40l-7 8 9-1zM47 40l7 8-9-1z" fill="white" fillOpacity="0.75" />
        <path d="M31 49c0 6 2.5 9 5 11 2.5-2 5-5 5-11z" fill="#FFC857" />
      </svg>
    );
  }
  if (art === "follow") {
    return (
      <svg viewBox="0 0 72 72" aria-hidden="true" className="h-[68px] w-[68px]">
        <circle cx="36" cy="36" r="34" fill="white" fillOpacity="0.12" />
        <circle cx="28" cy="29" r="8" fill="white" />
        <path d="M14 52c1-9 7-14 14-14s13 5 14 14z" fill="white" />
        <circle cx="45" cy="31" r="6" fill="white" fillOpacity="0.7" />
        <path d="M37 52c.5-4 2-7 4.5-9 1-.5 2.5-1 3.5-1 6 0 10 4 11 10z" fill="white" fillOpacity="0.7" />
        <circle cx="53" cy="19" r="7" fill="#3DDBA8" />
        <path d="M50 19.5l2 2 4-4.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 72 72" aria-hidden="true" className="h-[68px] w-[68px]">
      <circle cx="36" cy="36" r="34" fill="white" fillOpacity="0.12" />
      <circle cx="36" cy="36" r="19" fill="white" fillOpacity="0.35" />
      <path d="M36 17a19 19 0 0 1 18.4 23.7L36 36z" fill="white" />
      <path d="M36 36l18.4 4.7A19 19 0 0 1 42 54z" fill="#FFC857" />
      <circle cx="36" cy="36" r="7" fill="#6860FF" />
    </svg>
  );
}
