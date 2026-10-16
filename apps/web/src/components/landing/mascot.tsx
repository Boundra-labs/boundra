export type MascotPose = 'neutral' | 'guide' | 'thinking' | 'hold' | 'attention' | 'success';

const RING = { cx: 100, cy: 150, rx: 90, ry: 25 };

function ringPoint(degrees: number) {
  const t = (degrees * Math.PI) / 180;
  return `${(RING.cx + RING.rx * Math.cos(t)).toFixed(1)} ${(RING.cy + RING.ry * Math.sin(t)).toFixed(1)}`;
}

/** Ellipse arc between two angles (degrees, y-down, so 90° is the front of the ring). */
function ringArc(from: number, to: number) {
  const sweep = to > from ? 1 : 0;
  return `M${ringPoint(from)}A${RING.rx} ${RING.ry} 0 0 ${sweep} ${ringPoint(to)}`;
}

const backRing = [ringArc(186, 232), ringArc(238, 302), ringArc(308, 354)];
const frontRing = { left: ringArc(174, 124), center: ringArc(118, 62), right: ringArc(56, 6) };

interface Limb {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotate: number;
}

const arms: Record<MascotPose, [Limb, Limb]> = {
  neutral: [
    { cx: 40, cy: 150, rx: 16, ry: 12, rotate: -18 },
    { cx: 160, cy: 150, rx: 16, ry: 12, rotate: 18 },
  ],
  guide: [
    { cx: 40, cy: 150, rx: 16, ry: 12, rotate: -18 },
    { cx: 176, cy: 124, rx: 17, ry: 11, rotate: -28 },
  ],
  thinking: [
    { cx: 42, cy: 152, rx: 16, ry: 12, rotate: -18 },
    { cx: 120, cy: 140, rx: 12, ry: 16, rotate: -24 },
  ],
  hold: [
    { cx: 76, cy: 160, rx: 14, ry: 11, rotate: -8 },
    { cx: 124, cy: 160, rx: 14, ry: 11, rotate: 8 },
  ],
  attention: [
    { cx: 40, cy: 150, rx: 16, ry: 12, rotate: -18 },
    { cx: 178, cy: 120, rx: 17, ry: 11, rotate: -34 },
  ],
  success: [
    { cx: 30, cy: 98, rx: 12, ry: 19, rotate: -32 },
    { cx: 170, cy: 98, rx: 12, ry: 19, rotate: 32 },
  ],
};

const poses = Object.keys(arms) as MascotPose[];

/**
 * The Boundary Spirit. Decorative only: every status it reflects is also stated in text nearby.
 * Pose changes crossfade (450–650ms); it never rotates or spins between states.
 */
export function Mascot({
  id,
  pose = 'neutral',
  className = '',
}: {
  id: string;
  pose?: MascotPose;
  className?: string;
}) {
  const body = `${id}-body`;
  const face = `${id}-face`;
  const ring = `${id}-ring`;
  const shadow = `${id}-shadow`;
  return (
    <svg
      className={`mascot ${className}`}
      data-pose={pose}
      viewBox="0 0 200 222"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={body} cx="34%" cy="24%" r="82%">
          <stop offset="0" stopColor="#2f6b55" />
          <stop offset="0.55" stopColor="#1d4a3c" />
          <stop offset="1" stopColor="#11291f" />
        </radialGradient>
        <radialGradient id={face} cx="42%" cy="34%" r="70%">
          <stop offset="0" stopColor="#fdfdf8" />
          <stop offset="0.72" stopColor="#f1f2e6" />
          <stop offset="1" stopColor="#dcdfca" />
        </radialGradient>
        <linearGradient id={ring} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c0cfb2" />
          <stop offset="1" stopColor="#97ac88" />
        </linearGradient>
        <radialGradient id={shadow}>
          <stop offset="0" stopColor="#122d27" stopOpacity="0.28" />
          <stop offset="1" stopColor="#122d27" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="208" rx="82" ry="12" fill={`url(#${shadow})`} />

      <g className="mascot-figure">
        <g className="mascot-ring mascot-ring-back">
          {backRing.map((d) => (
            <g key={d}>
              <path d={d} className="ring-side" transform="translate(0 5)" />
              <path d={d} className="ring-face" stroke="#8aa07c" />
            </g>
          ))}
        </g>

        <ellipse cx="78" cy="198" rx="17" ry="12" fill={`url(#${body})`} />
        <ellipse cx="122" cy="198" rx="17" ry="12" fill={`url(#${body})`} />

        <path
          className="mascot-body"
          fill={`url(#${body})`}
          d="M150 14C136 9 104 16 77 36C47 58 30 94 30 130C30 170 60 197 100 197C140 197 170 170 170 130C170 101 161 79 149 63C140 51 139 38 145 28C147 24 150 19 150 14Z"
        />
        <path
          d="M64 54C78 40 96 30 116 26"
          fill="none"
          stroke="#3c7a62"
          strokeOpacity="0.45"
          strokeWidth="6"
          strokeLinecap="round"
        />

        <ellipse cx="98" cy="103" rx="52" ry="41" fill={`url(#${face})`} />

        <g className="mascot-eyes">
          <ellipse cx="81" cy="105" rx="6.5" ry="10.5" fill="#19332d" />
          <ellipse cx="116" cy="105" rx="6.5" ry="10.5" fill="#19332d" />
        </g>

        <g className="mascot-ring mascot-ring-front">
          {Object.entries(frontRing).map(([part, d]) => (
            <g key={part} className={`ring-segment ring-${part}`}>
              <path d={d} className="ring-side" transform="translate(0 6)" />
              <path d={d} className="ring-face" stroke={`url(#${ring})`} />
              <path d={d} className="ring-light" transform="translate(0 -6)" />
            </g>
          ))}
        </g>

        {poses.map((name) => (
          <g key={name} className={`mascot-arms arms-${name}`}>
            {arms[name].map((limb, index) => (
              <ellipse
                key={index}
                cx={limb.cx}
                cy={limb.cy}
                rx={limb.rx}
                ry={limb.ry}
                fill={`url(#${body})`}
                transform={`rotate(${limb.rotate} ${limb.cx} ${limb.cy})`}
              />
            ))}
          </g>
        ))}

        <g className="mascot-marks marks-success" stroke="#a6c74c">
          <path d="M22 54l-8-12M36 44l-2-15M12 70l-13-4" />
          <path d="M178 54l8-12M164 44l2-15M188 70l13-4" />
        </g>
        <g className="mascot-marks marks-attention" stroke="#d8a13b">
          <path d="M170 30l9-13M181 44l15-6M164 18l2-15" />
        </g>
        <g className="mascot-marks marks-thinking" stroke="#a6c74c">
          <path d="M168 34l8-11M178 47l13-5" />
        </g>
      </g>
    </svg>
  );
}
