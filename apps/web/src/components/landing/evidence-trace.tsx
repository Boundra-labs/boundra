'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Broadcast, Check, Document, Link } from './icons';
import { Mascot } from './mascot';
import { RibbonAnchor } from './ribbon-anchor';
import { ribbonGeometry, type RibbonGeometry } from './ribbon-geometry';

type Phase = 'waiting' | 'policy' | 'broadcast' | 'confirmed';
const order: Phase[] = ['waiting', 'policy', 'broadcast', 'confirmed'];
const reached = (phase: Phase, step: Phase) => order.indexOf(phase) >= order.indexOf(step);

const stages = [
  {
    phase: 'policy' as const,
    title: 'Policy checked',
    icon: Document,
    before: 'Waiting',
    active: 'Inside the mandate',
    done: 'Inside the mandate',
  },
  {
    phase: 'broadcast' as const,
    title: 'Broadcast',
    icon: Broadcast,
    before: 'Not sent',
    active: 'Sent · awaiting confirmation',
    done: 'Sent',
  },
  {
    phase: 'confirmed' as const,
    title: 'Confirmed',
    icon: Link,
    before: 'Pending',
    active: 'Receipt verified',
    done: 'Receipt verified',
  },
];

/**
 * An illustrative walk through the evidence states. Broadcast is never drawn as success: the lime
 * trace and the success pose appear only at the confirmed step.
 */
export function EvidenceTrace() {
  const stageRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const timers = useRef<number[]>([]);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [trace, setTrace] = useState<{ geometry: RibbonGeometry; w: number; h: number } | null>(
    null,
  );

  const play = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase('confirmed');
      return;
    }
    setPhase('waiting');
    timers.current = [
      window.setTimeout(() => setPhase('policy'), 350),
      window.setTimeout(() => setPhase('broadcast'), 1350),
      window.setTimeout(() => setPhase('confirmed'), 4300),
    ];
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const box = stage.getBoundingClientRect();
      const points = nodeRefs.current.flatMap((node) => {
        if (!node) return [];
        const r = node.getBoundingClientRect();
        return [{ x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top }];
      });
      const geometry = ribbonGeometry(points);
      setTrace(geometry ? { geometry, w: stage.offsetWidth, h: stage.offsetHeight } : null);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(stage);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        play();
        observer.disconnect();
      },
      { threshold: 0.45 },
    );
    observer.observe(stage);
    const pending = timers.current;
    return () => {
      resize.disconnect();
      observer.disconnect();
      pending.forEach(window.clearTimeout);
    };
  }, [play]);

  const length = trace?.geometry.length ?? 0;
  const toBroadcast = trace?.geometry.lengthAt[1] ?? 0;
  const sent = reached(phase, 'broadcast') ? toBroadcast : 0;
  const confirmed = phase === 'confirmed';

  return (
    <div className="trace-stage" ref={stageRef} data-phase={phase}>
      <RibbonAnchor order={595} x="0" y="0" mx="-36px" my="64px" dir="v" only="mobile" />
      <p className="trace-caption">Illustrative sequence · no real transaction</p>
      {trace && (
        <svg
          className="trace-svg"
          width={trace.w}
          height={trace.h}
          viewBox={`0 0 ${trace.w} ${trace.h}`}
          aria-hidden="true"
          focusable="false"
        >
          <path d={trace.geometry.d} className="trace-base" />
          <path
            d={trace.geometry.d}
            className="trace-sent"
            style={{ strokeDasharray: `${length} ${length}`, strokeDashoffset: length - sent }}
          />
          <path
            d={trace.geometry.d}
            className="trace-confirmed"
            style={{
              strokeDasharray: `${length} ${length}`,
              strokeDashoffset: confirmed ? 0 : length,
            }}
          />
        </svg>
      )}
      {trace && phase === 'broadcast' && (
        <span
          className="trace-dot"
          aria-hidden="true"
          style={
            {
              offsetPath: `path('${trace.geometry.d}')`,
              '--from': `${(toBroadcast / length) * 100}%`,
            } as CSSProperties
          }
        />
      )}

      <ol className="trace-steps">
        {stages.map((stage, index) => {
          const isReached = reached(phase, stage.phase);
          const isCurrent = phase === stage.phase;
          const done = isReached && (!isCurrent || stage.phase !== 'broadcast');
          const Icon = stage.icon;
          return (
            <li
              key={stage.phase}
              className={`trace-step${done ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
            >
              <span
                className="trace-node"
                ref={(node) => {
                  nodeRefs.current[index] = node;
                }}
              >
                {index === 0 && <RibbonAnchor order={600} x="50%" y="50%" />}
                <Icon />
              </span>
              <span className="trace-text">
                <strong>{stage.title}</strong>
                <span>{isReached ? (isCurrent ? stage.active : stage.done) : stage.before}</span>
              </span>
              <span className="trace-check" aria-hidden="true">
                {done && <Check />}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="trace-mascot" data-ambient>
        <Mascot id="evidence" pose={confirmed ? 'success' : 'hold'} />
      </div>
      <button type="button" className="trace-replay" onClick={play}>
        Replay sequence
      </button>
    </div>
  );
}
