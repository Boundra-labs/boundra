import type { ReactNode, SVGProps } from 'react';

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const ArrowDown = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);
export const Check = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
export const Alert = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 7v6M12 16.5v.5" />
  </Icon>
);
export const Minus = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M7 12h10" />
  </Icon>
);
export const Sparkle = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z" />
  </Icon>
);
export const Person = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 19.5c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5" />
  </Icon>
);
export const Sliders = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);
export const List = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.5" cy="6.5" r=".6" />
    <circle cx="4.5" cy="12" r=".6" />
    <circle cx="4.5" cy="17.5" r=".6" />
  </Icon>
);
export const Document = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M7 3h7l4 4v14H7z" />
    <path d="M14 3v4h4M10 12h5M10 16h5" />
  </Icon>
);
export const Broadcast = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="1.6" />
    <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
  </Icon>
);
export const Link = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);
export const Pause = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M9 7v10M15 7v10" />
  </Icon>
);
export const Hand = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 4v8M12 4a1.5 1.5 0 0 1 3 0v8M15 6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.5 15a1.6 1.6 0 0 1 2.6-1.8L9 15V7a1.5 1.5 0 0 1 3 0" />
  </Icon>
);
export const Stop = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M7 17L17 7" />
  </Icon>
);
export const Card = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="4" y="6" width="16" height="12" rx="3" />
    <path d="M8 10h8M8 14h5" />
  </Icon>
);
