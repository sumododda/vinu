import type { SVGProps } from 'react';

type MarkProps = SVGProps<SVGSVGElement>;

/**
 * Logo mark — microphone capsule + speech bubble with knockout dots
 * flanking a stylised V. Uses `currentColor`, so set it via CSS `color`.
 */
export function LogoMark({
  size = 24,
  ...rest
}: MarkProps & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="vinu"
      role="img"
      {...rest}
    >
      <defs>
        <mask id="vinu-bubble-mask">
          <rect x="34" y="8" width="20" height="13" rx="4" fill="white" />
          <circle cx="39" cy="14.5" r="1.3" fill="black" />
          <circle cx="44" cy="14.5" r="1.3" fill="black" />
          <circle cx="49" cy="14.5" r="1.3" fill="black" />
        </mask>
      </defs>
      <path
        d="M16 23 L32 55"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M44 21 L32 55"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <rect x="11" y="7" width="10" height="17" rx="5" fill="currentColor" />
      <rect
        x="34"
        y="8"
        width="20"
        height="13"
        rx="4"
        fill="currentColor"
        mask="url(#vinu-bubble-mask)"
      />
    </svg>
  );
}

/**
 * Full brand lockup: mark + Libre Bodoni italic "vinu" wordmark.
 * Use on splash / about / empty-state moments.
 */
export function LogoLockup({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const markSize = Math.round(size * 1.25);
  return (
    <span className={`logo-lockup ${className ?? ''}`} aria-label="vinu">
      <LogoMark size={markSize} aria-hidden />
      <span className="logo-lockup-text" style={{ fontSize: size }}>
        vinu
      </span>
    </span>
  );
}
