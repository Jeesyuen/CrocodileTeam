/* Original soft-3D isometric illustrations drawn in SVG (no external artwork). */

const U = 18;
const CX = 250, CY = 120;
const P = (x: number, y: number, z = 0) => [CX + (x - y) * 0.866 * U, CY + (x + y) * 0.5 * U - z * U] as const;
const pts = (...p: (readonly [number, number])[]) => p.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");

function Box({ x, y, w, d, h, top, left, right, windows }: {
  x: number; y: number; w: number; d: number; h: number; top: string; left: string; right: string; windows?: boolean;
}) {
  const lines = [];
  if (windows) {
    for (let z = 0.8; z < h - 0.4; z += 0.9) {
      lines.push(<polyline key={`r${z}`} points={pts(P(x + w, y + 0.35, z), P(x + w, y + d - 0.35, z))} stroke="#fff" strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" />);
      lines.push(<polyline key={`l${z}`} points={pts(P(x + 0.35, y + d, z), P(x + w - 0.35, y + d, z))} stroke="#fff" strokeOpacity=".45" strokeWidth="3" strokeLinecap="round" />);
    }
  }
  return (
    <g>
      <polygon points={pts(P(x, y + d, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x, y + d, h))} fill={left} />
      <polygon points={pts(P(x + w, y, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x + w, y, h))} fill={right} />
      <polygon points={pts(P(x, y, h), P(x + w, y, h), P(x + w, y + d, h), P(x, y + d, h))} fill={top} />
      {lines}
    </g>
  );
}

function Tree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  const [bx, by] = P(x, y, 0);
  return (
    <g>
      <ellipse cx={bx} cy={by + 2} rx={9 * s} ry={4 * s} fill="#202124" opacity=".06" />
      <rect x={bx - 2} y={by - 14 * s} width={4} height={14 * s} rx={2} fill="#C9A27E" />
      <circle cx={bx} cy={by - 20 * s} r={11 * s} fill="#8FD3C1" />
      <circle cx={bx - 4 * s} cy={by - 24 * s} r={5 * s} fill="#B7E6D9" />
    </g>
  );
}

function Car({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g>
      <Box x={x} y={y} w={1.6} d={0.9} h={0.45} top={color} left={color} right={color} />
      <Box x={x + 0.35} y={y + 0.1} w={0.8} d={0.7} h={0.85} top="#ffffff" left="#E6F5FF" right="#F4FBFF" />
    </g>
  );
}

export function CityIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 500 330" className={className} role="img" aria-label="Miniature Cyberjaya city illustration">
      <defs>
        <linearGradient id="g-route" x1="0" x2="1">
          <stop offset="0" stopColor="#7968C9" /><stop offset="1" stopColor="#3FAE97" />
        </linearGradient>
      </defs>
      {/* ground */}
      <polygon points={pts(P(-1, -1), P(11, -1), P(11, 11), P(-1, 11))} fill="#F1F3F7" />
      <polygon points={pts(P(-1, 11), P(11, 11), P(11, 11, -0.6), P(-1, 11, -0.6))} fill="#E3E6EE" />
      <polygon points={pts(P(11, -1), P(11, 11), P(11, 11, -0.6), P(11, -1, -0.6))} fill="#D8DCE6" />
      {/* roads */}
      <polygon points={pts(P(4.2, -1), P(5.8, -1), P(5.8, 11), P(4.2, 11))} fill="#E1E4EC" />
      <polygon points={pts(P(-1, 4.2), P(11, 4.2), P(11, 5.8), P(-1, 5.8))} fill="#E1E4EC" />
      {[0, 2, 7, 9].map((t) => <polyline key={`a${t}`} points={pts(P(5, t), P(5, t + 0.8))} stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />)}
      {[0, 2, 7, 9].map((t) => <polyline key={`b${t}`} points={pts(P(t, 5), P(t + 0.8, 5))} stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />)}
      {/* safe route highlight */}
      <polyline points={pts(P(0.5, 5), P(5, 5), P(5, 9.8))} fill="none" stroke="url(#g-route)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
      {/* parks */}
      <polygon points={pts(P(6.4, 6.4), P(10.4, 6.4), P(10.4, 10.4), P(6.4, 10.4))} fill="#DDF2F1" />
      {/* buildings (back to front) */}
      <Box x={0} y={0} w={3.4} d={3.2} h={5.2} top="#F4F1FF" left="#D9D0FF" right="#E9E3FF" windows />
      <Box x={6.4} y={0} w={3.6} d={2.4} h={3.4} top="#F4FBFF" left="#CFE9FA" right="#E6F5FF" windows />
      <Box x={6.6} y={2.6} w={1.4} d={1.2} h={7.4} top="#EEF8F7" left="#C5E6E3" right="#DDF2F1" windows />
      <Box x={0.2} y={6.4} w={3} d={3.4} h={2.6} top="#FFF6EA" left="#F6D9B4" right="#FDEBD3" windows />
      {/* trees */}
      <Tree x={7.4} y={7.6} /><Tree x={9.2} y={8.6} s={1.2} /><Tree x={8.2} y={9.8} s={0.9} />
      <Tree x={3.8} y={3.6} s={0.8} /><Tree x={2.8} y={10.2} s={0.8} />
      {/* cars */}
      <Car x={1.4} y={4.6} color="#7968C9" />
      <Car x={4.6} y={7.2} color="#58B99B" />
      {/* cone + warning */}
      <g transform={`translate(${P(6.1, 4.3)[0]} ${P(6.1, 4.3)[1]})`}>
        <ellipse cx="0" cy="2" rx="9" ry="3.5" fill="#202124" opacity=".08" />
        <path d="M-7 1 L0 -20 L7 1 Z" fill="#F4B860" />
        <path d="M-4.3 -7 L4.3 -7 L5.3 -4 L-5.3 -4 Z" fill="#fff" />
        <rect x="-9" y="0" width="18" height="3" rx="1.5" fill="#E9A23F" />
      </g>
      {/* destination pin */}
      <g transform={`translate(${P(5, 9.8)[0]} ${P(5, 9.8)[1] - 4})`}>
        <ellipse cx="0" cy="6" rx="8" ry="3" fill="#202124" opacity=".1" />
        <path d="M0 4 C-10 -8 -12 -14 -12 -20 A12 12 0 0 1 12 -20 C12 -14 10 -8 0 4 Z" fill="#7968C9" />
        <circle cx="0" cy="-20" r="5" fill="#DDF2F1" />
      </g>
      {/* start dot */}
      <g transform={`translate(${P(0.5, 5)[0]} ${P(0.5, 5)[1]})`}>
        <circle r="7" fill="#fff" /><circle r="4" fill="#3FAE97" />
      </g>
    </svg>
  );
}

export function Cone({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      <ellipse cx="60" cy="98" rx="38" ry="10" fill="#E9E3FF" />
      <path d="M40 92 L60 24 L80 92 Z" fill="#F4B860" />
      <path d="M48 66 L72 66 L75 76 L45 76 Z" fill="#fff" />
      <path d="M53 48 L67 48 L69 55 L51 55 Z" fill="#fff" />
      <rect x="32" y="88" width="56" height="8" rx="4" fill="#E9A23F" />
      <circle cx="94" cy="34" r="10" fill="#DDF2F1" />
      <circle cx="24" cy="46" r="6" fill="#E6F5FF" />
    </svg>
  );
}

export function Logo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="18" fill="#E9E3FF" />
      <path d="M32 12c-8 0-14 6-14 14 0 10 14 26 14 26s14-16 14-26c0-8-6-14-14-14z" fill="#7968C9" />
      <circle cx="32" cy="26" r="5.5" fill="#DDF2F1" />
    </svg>
  );
}
