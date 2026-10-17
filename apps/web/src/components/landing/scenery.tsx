/**
 * Decorative environments for each section. Shapes overlap section edges so the page reads as
 * one landscape: ivory dunes → sage mist → deep forest → ivory again.
 */

type Blob = [x: number, y: number, r: number];

function Bush({ blobs, tone, id }: { blobs: Blob[]; tone: 'sage' | 'green' | 'deep'; id: string }) {
  const stops = {
    sage: ['#b9c9a8', '#8fa67f'],
    green: ['#7fa06c', '#3f6b4c'],
    deep: ['#2f5a45', '#173a2e'],
  }[tone];
  return (
    <>
      <defs>
        <radialGradient id={id} cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor={stops[0]} />
          <stop offset="1" stopColor={stops[1]} />
        </radialGradient>
      </defs>
      <g fill={`url(#${id})`}>
        {blobs.map(([x, y, r]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
        ))}
      </g>
    </>
  );
}

function Rock({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <ellipse cx={x} cy={y} rx={w} ry={h} fill="#c4c8bd" />
      <ellipse cx={x - w * 0.18} cy={y - h * 0.3} rx={w * 0.6} ry={h * 0.5} fill="#d6d9cf" />
    </g>
  );
}

function Contours({
  cx,
  cy,
  count,
  stroke,
}: {
  cx: number;
  cy: number;
  count: number;
  stroke: string;
}) {
  return (
    <g fill="none" stroke={stroke} strokeWidth="1.2">
      {Array.from({ length: count }, (_, i) => {
        const rx = 120 + i * 70;
        const ry = 36 + i * 22;
        const wobble = 14 + i * 6;
        return (
          <path
            key={i}
            d={`M${cx - rx} ${cy}C${cx - rx} ${cy - ry - wobble} ${cx - rx * 0.2} ${cy - ry} ${cx + rx * 0.3} ${cy - ry + wobble * 0.4}C${cx + rx} ${cy - ry + wobble} ${cx + rx} ${cy + ry * 0.4} ${cx + rx * 0.4} ${cy + ry}C${cx - rx * 0.3} ${cy + ry + wobble} ${cx - rx} ${cy + ry * 0.6} ${cx - rx} ${cy}Z`}
          />
        );
      })}
    </g>
  );
}

const scene = { className: 'scene', 'aria-hidden': true, focusable: false } as const;

export function HeroScene() {
  return (
    <svg {...scene} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="hero-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef1e5" />
          <stop offset="1" stopColor="#e3e8d8" />
        </linearGradient>
        <linearGradient id="hero-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7f8f1" />
          <stop offset="1" stopColor="#e6ebdc" />
        </linearGradient>
        <linearGradient id="hero-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbfbf6" />
          <stop offset="1" stopColor="#eceee3" />
        </linearGradient>
        <radialGradient id="hero-pool" cx="50%" cy="20%" r="80%">
          <stop offset="0" stopColor="#1f4a3b" />
          <stop offset="1" stopColor="#0f251e" />
        </radialGradient>
        <filter id="hero-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <path
        fill="url(#hero-far)"
        d="M0 470C210 420 400 500 640 470C860 442 1020 330 1240 370C1340 388 1400 420 1440 432V900H0Z"
      />
      <g opacity="0.85">
        <Bush
          id="hero-bush-r"
          tone="green"
          blobs={[
            [1250, 392, 30],
            [1290, 378, 36],
            [1338, 388, 30],
            [1380, 372, 34],
            [1420, 384, 30],
          ]}
        />
        <Rock x={1330} y={414} w={46} h={22} />
      </g>
      <path
        fill="url(#hero-mid)"
        d="M0 610C190 560 380 640 600 620C840 598 1000 520 1200 540C1320 552 1400 590 1440 600V900H0Z"
      />
      <path
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.7"
        strokeWidth="3"
        d="M0 610C190 560 380 640 600 620C840 598 1000 520 1200 540C1320 552 1400 590 1440 600"
      />
      <path
        fill="url(#hero-near)"
        d="M0 760C220 700 420 760 560 790C700 820 820 760 980 760C1160 760 1300 820 1440 800V900H0Z"
      />
      <path
        fill="url(#hero-pool)"
        d="M340 900C380 836 520 790 740 792C980 794 1130 840 1180 900Z"
      />
      <Contours cx={760} cy={880} count={4} stroke="rgba(166,199,76,0.16)" />
      <g filter="url(#hero-soft)" opacity="0.9">
        <Bush
          id="hero-bush-l"
          tone="green"
          blobs={[
            [10, 640, 46],
            [62, 610, 38],
            [40, 700, 52],
            [110, 690, 34],
          ]}
        />
        <Bush
          id="hero-bush-fr"
          tone="deep"
          blobs={[
            [1380, 860, 70],
            [1440, 800, 64],
            [1310, 900, 54],
          ]}
        />
      </g>
      <Rock x={92} y={752} w={60} h={26} />
    </svg>
  );
}

export function MistScene({ id, flip = false }: { id: string; flip?: boolean }) {
  return (
    <svg
      {...scene}
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      <defs>
        <linearGradient id={`${id}-hill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9e1cf" />
          <stop offset="1" stopColor="#d9e1cf" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-hill-2`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ccd7c0" />
          <stop offset="1" stopColor="#ccd7c0" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id}-hill)`}
        d="M0 300C140 250 260 210 380 250C460 276 520 330 600 360V900H0Z"
      />
      <path
        fill={`url(#${id}-hill-2)`}
        d="M1440 420C1320 340 1200 300 1080 340C980 372 920 440 840 480V900H1440Z"
      />
      <g opacity="0.55">
        <Bush
          id={`${id}-bush-a`}
          tone="sage"
          blobs={[
            [60, 330, 26],
            [96, 312, 32],
            [134, 330, 24],
          ]}
        />
        <Bush
          id={`${id}-bush-b`}
          tone="sage"
          blobs={[
            [1260, 380, 28],
            [1300, 362, 34],
            [1344, 380, 26],
            [1390, 368, 30],
          ]}
        />
      </g>
    </svg>
  );
}

export function ForestEdge() {
  return (
    <svg {...scene} className="scene scene-edge" viewBox="0 0 1440 520" preserveAspectRatio="none">
      <defs>
        <linearGradient id="edge-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5f8467" />
          <stop offset="1" stopColor="#2a5040" />
        </linearGradient>
        <linearGradient id="edge-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24493b" />
          <stop offset="1" stopColor="#122d27" />
        </linearGradient>
      </defs>
      <path
        fill="url(#edge-back)"
        opacity="0.55"
        d="M0 250C80 210 150 230 210 200C270 170 330 190 380 220C470 270 560 230 660 250C780 274 880 210 1000 220C1110 230 1180 190 1270 200C1350 210 1400 240 1440 230V520H0Z"
      />
      <path
        fill="url(#edge-front)"
        d="M0 330C120 300 230 340 360 320C500 298 620 360 780 350C930 340 1040 290 1180 300C1290 308 1380 340 1440 330V520H0Z"
      />
    </svg>
  );
}

export function EvidenceScene() {
  return (
    <svg {...scene} viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="ev-glow" cx="70%" cy="35%" r="55%">
          <stop offset="0" stopColor="#23674e" stopOpacity="0.45" />
          <stop offset="1" stopColor="#23674e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="1000" fill="url(#ev-glow)" />
      <Contours cx={980} cy={520} count={6} stroke="rgba(155,175,141,0.08)" />
      <g opacity="0.9">
        <Bush
          id="ev-bush-a"
          tone="deep"
          blobs={[
            [40, 820, 70],
            [130, 860, 60],
            [220, 900, 70],
            [1300, 860, 80],
            [1400, 820, 70],
          ]}
        />
      </g>
      <g fill="#1c3d33">
        <ellipse cx="420" cy="930" rx="90" ry="36" />
        <ellipse cx="1120" cy="950" rx="120" ry="42" />
      </g>
    </svg>
  );
}

export function ClosingScene() {
  return (
    <svg {...scene} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="close-dune" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef1e6" />
          <stop offset="1" stopColor="#e2e8d6" />
        </linearGradient>
      </defs>
      <path
        fill="url(#close-dune)"
        d="M0 700C220 650 460 720 700 700C940 680 1140 620 1440 660V900H0Z"
      />
      <g opacity="0.8">
        <Bush
          id="close-bush"
          tone="sage"
          blobs={[
            [1180, 668, 22],
            [1214, 654, 28],
            [1250, 668, 20],
          ]}
        />
        <Bush
          id="close-bush-l"
          tone="green"
          blobs={[
            [70, 700, 30],
            [110, 684, 26],
          ]}
        />
      </g>
    </svg>
  );
}
