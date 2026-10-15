import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };
}

export const IconMinimize = (p: IconProps) => (
  <svg {...base({ size: 14, ...p })}>
    <path d="M5 12h14" />
  </svg>
);
export const IconMaximize = (p: IconProps) => (
  <svg {...base({ size: 14, ...p })}>
    <rect x="5" y="5" width="14" height="14" rx="3" />
  </svg>
);
export const IconRestore = (p: IconProps) => (
  <svg {...base({ size: 14, ...p })}>
    <rect x="5" y="8" width="11" height="11" rx="2.5" />
    <path d="M9 5h7.5A2.5 2.5 0 0 1 19 7.5V15" />
  </svg>
);
export const IconClose = (p: IconProps) => (
  <svg {...base({ size: 14, ...p })}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconFlip = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 4v13M7 17l-3-3M7 17l3-3M17 20V7M17 7l-3 3M17 7l3 3" />
  </svg>
);
export const IconFirst = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M17 18l-6-6 6-6M7 6v12" />
  </svg>
);
export const IconPrev = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
export const IconNext = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);
export const IconLast = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 18l6-6-6-6M17 6v12" />
  </svg>
);
export const IconUndo = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);
export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconFlag = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </svg>
);
export const IconVolume = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 10v4h4l5 4V6L8 10H4z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
  </svg>
);
export const IconMute = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 10v4h4l5 4V6L8 10H4z" />
    <path d="M17 9l5 6M22 9l-5 6" />
  </svg>
);
export const IconFlask = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 3h6M10 3v6L4.5 18.5A1.8 1.8 0 0 0 6 21h12a1.8 1.8 0 0 0 1.5-2.5L14 9V3" />
    <path d="M7.5 14h9" />
  </svg>
);
export const IconPlay = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" />
  </svg>
);
export const IconPuzzle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 4a2 2 0 1 1 4 0v1h4v4h-1a2 2 0 1 0 0 4h1v5H5v-5h1a2 2 0 1 0 0-4H5V5h5z" />
  </svg>
);
export const IconChart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 19h16M6 16l4-5 3 3 5-7" />
  </svg>
);
export const IconGrid = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
);
export const IconGlobe = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.5 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.5-3.6-8.5S9.5 6.1 12 3.5z" />
  </svg>
);
export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const IconBook = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
  </svg>
);
