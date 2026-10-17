import type { CSSProperties } from 'react';
import type { RibbonDirection } from './ribbon-geometry';

export type RibbonName = 'main' | 'branch' | 'return';

/**
 * An invisible point the ribbon passes through, positioned as a percentage of its nearest
 * positioned ancestor. `mx`/`my` override the position below 760px; `only` drops the point on
 * one layout. Points of one ribbon are joined in `order`, across sections.
 */
export function RibbonAnchor({
  ribbon = 'main',
  order,
  x,
  y,
  mx,
  my,
  dir,
  only,
  tone,
  glintEnd,
}: {
  ribbon?: RibbonName;
  order: number;
  x: string;
  y: string;
  mx?: string;
  my?: string;
  dir?: RibbonDirection;
  only?: 'desktop' | 'mobile';
  tone?: 'sage' | 'amber' | 'pending';
  glintEnd?: boolean;
}) {
  const style = { '--x': x, '--y': y, '--mx': mx ?? x, '--my': my ?? y } as CSSProperties;
  return (
    <i
      className="rb-pt"
      aria-hidden="true"
      style={style}
      data-rb={ribbon}
      data-rb-order={order}
      data-rb-dir={dir}
      data-rb-only={only}
      data-rb-tone={tone}
      data-rb-glint={glintEnd ? '' : undefined}
    />
  );
}
