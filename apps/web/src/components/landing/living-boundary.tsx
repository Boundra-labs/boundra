'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ribbonGeometry, type RibbonDirection, type RibbonGeometry } from './ribbon-geometry';
import type { RibbonName } from './ribbon-anchor';

interface MeasuredRibbon {
  name: RibbonName;
  geometry: RibbonGeometry;
  ys: number[];
  tone: string;
  glintAt: number | null;
  /** The hero part of the ribbon (up to the glint end) is drawn on arrival at any viewport. */
  arrivalY: number;
}

/** How each ribbon reveals: in settled steps per landmark, or whole once it is reached. */
const REVEAL: Record<RibbonName, 'steps' | 'whole'> = {
  main: 'steps',
  branch: 'whole',
  return: 'steps',
};

/** The reading line: a landmark counts as reached once it passes this share of the viewport. */
const READING_LINE = 0.82;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Layout position of an element inside `root`, ignoring transforms used by reveal motion. */
function offsetWithin(element: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return node === root ? { x, y } : null;
}

function measure(root: HTMLElement): MeasuredRibbon[] {
  const groups = new Map<RibbonName, { order: number; x: number; y: number; el: HTMLElement }[]>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-rb]')) {
    if (el.offsetParent === null) continue; // hidden on this layout
    const at = offsetWithin(el, root);
    if (!at) continue;
    const name = el.dataset.rb as RibbonName;
    const list = groups.get(name) ?? [];
    list.push({ order: Number(el.dataset.rbOrder), ...at, el });
    groups.set(name, list);
  }
  const ribbons: MeasuredRibbon[] = [];
  for (const [name, list] of groups) {
    list.sort((a, b) => a.order - b.order);
    const geometry = ribbonGeometry(
      list.map((p) => ({ x: p.x, y: p.y, dir: p.el.dataset.rbDir as RibbonDirection | undefined })),
    );
    if (!geometry) continue;
    const glintIndex = list.findIndex((p) => p.el.dataset.rbGlint !== undefined);
    ribbons.push({
      name,
      geometry,
      ys: list.map((p) => p.y),
      tone: list.find((p) => p.el.dataset.rbTone)?.el.dataset.rbTone ?? 'sage',
      glintAt: glintIndex > 0 ? geometry.lengthAt[glintIndex]! : null,
      arrivalY: glintIndex > 0 ? Math.max(...list.slice(0, glintIndex + 1).map((p) => p.y)) : 0,
    });
  }
  return ribbons;
}

/** Index of the last landmark reached without skipping an unreached one before it. */
function reachedIndex(ys: number[], line: number) {
  let reached = -1;
  let highest = -Infinity;
  for (let i = 0; i < ys.length; i++) {
    highest = Math.max(highest, ys[i]!);
    if (highest > line) break;
    reached = i;
  }
  return reached;
}

/**
 * The Living Boundary: one ribbon drawn through anchors placed in every section, revealed in
 * settled steps as the reader reaches each landmark. Also runs the page's reveal-on-enter and
 * pauses ambient motion when the page or an element is not visible. Everything it draws is
 * decorative; content and status never depend on it.
 */
export function LivingBoundary({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ribbons, setRibbons] = useState<MeasuredRibbon[]>([]);
  const [reached, setReached] = useState<Partial<Record<RibbonName, number>>>({});
  const [reduced, setReduced] = useState(false);
  const ribbonsRef = useRef<MeasuredRibbon[]>([]);

  const advance = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    const line = window.innerHeight * READING_LINE - top;
    setReached((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const ribbon of ribbonsRef.current) {
        let index = reachedIndex(ribbon.ys, Math.max(line, ribbon.arrivalY));
        if (REVEAL[ribbon.name] === 'whole' && index >= 0) index = ribbon.ys.length - 1;
        // Reveal never runs backwards: scrolling up keeps what has already been explained.
        if (index > (next[ribbon.name] ?? -1)) {
          next[ribbon.name] = index;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, []);

  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setReduced(query.matches);
    syncMotion();
    query.addEventListener('change', syncMotion);
    root.classList.add('lb-ready');

    let frame = 0;
    const remeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setSize({ width: root.offsetWidth, height: root.offsetHeight });
        ribbonsRef.current = measure(root);
        setRibbons(ribbonsRef.current);
        // Let the first draw start from zero, then settle on the reached landmark.
        requestAnimationFrame(advance);
      });
    };
    remeasure();
    const resize = new ResizeObserver(remeasure);
    resize.observe(root);
    const tones = new MutationObserver(remeasure);
    tones.observe(root, { subtree: true, attributeFilter: ['data-rb-tone'] });
    void document.fonts?.ready.then(remeasure);

    let scrollFrame = 0;
    const onScroll = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(advance);
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          reveal.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    root.querySelectorAll('[data-reveal]').forEach((el) => reveal.observe(el));

    const ambient = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle('is-live', entry.isIntersecting);
    });
    root.querySelectorAll('[data-ambient]').forEach((el) => ambient.observe(el));

    const onVisibility = () => root.classList.toggle('lb-paused', document.hidden);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      query.removeEventListener('change', syncMotion);
      resize.disconnect();
      tones.disconnect();
      reveal.disconnect();
      ambient.disconnect();
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [advance]);

  return (
    <div ref={rootRef} className="lb-root">
      {size.width > 0 && (
        <svg
          className="lb-ribbons"
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
          aria-hidden="true"
          focusable="false"
        >
          {ribbons.map((ribbon) => {
            const { d, length, lengthAt } = ribbon.geometry;
            const index = reached[ribbon.name] ?? -1;
            const shown = reduced ? length : index < 0 ? 0 : lengthAt[index]!;
            const dash = {
              strokeDasharray: `${length} ${length}`,
              strokeDashoffset: length - shown,
            };
            return (
              <g key={ribbon.name} className={`rb rb-${ribbon.name}`} data-tone={ribbon.tone}>
                <path d={d} className="rb-shadow" style={dash} />
                <path d={d} className="rb-side" style={dash} />
                <path d={d} className="rb-face" style={dash} />
                <path d={d} className="rb-light" style={dash} />
                {ribbon.glintAt !== null && !reduced && (
                  <path
                    d={d}
                    className="rb-glint"
                    style={
                      {
                        strokeDasharray: `90 ${length + 200}`,
                        '--glint-to': -ribbon.glintAt,
                      } as CSSProperties
                    }
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {children}
    </div>
  );
}
