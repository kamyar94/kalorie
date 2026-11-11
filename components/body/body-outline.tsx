/**
 * Where to measure (board 12): a body outline with a line at the neck, chest, waist (orange), hips,
 * upper arms, thighs and calves. The labels next to it say the same in words.
 */
export const BodyOutline = () => (
  <svg
    width="96"
    height="250"
    viewBox="0 0 96 250"
    fill="none"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-label="Where to measure: neck, chest, waist, hips, upper arm, thigh and calf"
    className="stroke-muted hidden shrink-0 min-[380px]:block"
  >
    <circle cx="48" cy="20" r="14" />
    <path d="M34 40h28l8 60-6 4M34 40l-8 60 6 4M34 40l-2 70 2 50 0 80M62 40l2 70-2 50 0 80M34 160h28" />
    <path d="M30 44h36" className="stroke-primary" strokeWidth={3} />
    <path d="M30 66h36" className="stroke-primary" strokeWidth={3} />
    <path d="M31 104h34" className="stroke-energy" strokeWidth={3} />
    <path d="M31 128h34" className="stroke-primary" strokeWidth={3} />
    <path d="M33 182h14M49 182h14" className="stroke-primary" strokeWidth={3} />
    <path d="M34 214h12M50 214h12" className="stroke-primary" strokeWidth={3} />
  </svg>
);
