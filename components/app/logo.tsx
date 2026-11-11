/** Kal's mark: a plate seen from above with a leaf, in the brand green. */
export const Logo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 64 64" aria-hidden className={className}>
    <rect width="64" height="64" rx="16" className="fill-primary" />
    <circle cx="32" cy="32" r="19" fill="none" strokeWidth="4" className="stroke-on-primary" />
    <path
      d="M24 38c0-9 6-15 17-16-1 11-7 17-16 17"
      fill="none"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stroke-on-primary"
    />
  </svg>
);
