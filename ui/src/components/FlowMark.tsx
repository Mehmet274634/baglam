import { useId } from "preact/hooks";

/**
 * A light version of the website's connections visual for empty states: two agents on the left send
 * to Bağlam (indigo), Bağlam shares with two agents on the right (cyan). Kept cheap on purpose: one
 * small SVG, four packets moving with SMIL, radial-gradient glows, no filters, no JavaScript timers.
 */
const IN = ["M31 22 C 76 22, 92 42, 122 42", "M31 62 C 76 62, 92 42, 122 42"];
const OUT = ["M158 42 C 188 42, 204 22, 249 22", "M158 42 C 188 42, 204 62, 249 62"];
const NODES: [number, number, string][] = [
  [22, 22, "#E8916F"],
  [22, 62, "#c9d1ff"],
  [258, 22, "#b49cf0"],
  [258, 62, "#4fe0d8"],
];

export function FlowMark() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const p = (name: string) => `fm-${id}-${name}`;
  const packets = [
    ...IN.map((_, i) => ({ path: p(`in${i}`), glow: p("gi"), dot: "#b3aeff", begin: `${i * 1.6}s` })),
    ...OUT.map((_, i) => ({ path: p(`out${i}`), glow: p("go"), dot: "#6fe0da", begin: `${0.8 + i * 1.6}s` })),
  ];
  return (
    <svg class="flow-mark" viewBox="0 0 280 84" width="280" height="84" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id={p("gi")}>
          <stop offset="0" stop-color="#7c74ff" stop-opacity="0.55" />
          <stop offset="1" stop-color="#7c74ff" stop-opacity="0" />
        </radialGradient>
        <radialGradient id={p("go")}>
          <stop offset="0" stop-color="#3fd0c9" stop-opacity="0.5" />
          <stop offset="1" stop-color="#3fd0c9" stop-opacity="0" />
        </radialGradient>
        <radialGradient id={p("core")}>
          <stop offset="0" stop-color="#7c74ff" stop-opacity="0.32" />
          <stop offset="1" stop-color="#7c74ff" stop-opacity="0" />
        </radialGradient>
        <linearGradient id={p("lens")} x1="137" y1="35" x2="143" y2="49" gradientUnits="userSpaceOnUse">
          <stop stop-color="#958fff" />
          <stop offset="1" stop-color="#3fd0c9" />
        </linearGradient>
      </defs>

      {IN.map((d, i) => (
        <path key={`i${i}`} id={p(`in${i}`)} d={d} class="flow-lane flow-lane-in" />
      ))}
      {OUT.map((d, i) => (
        <path key={`o${i}`} id={p(`out${i}`)} d={d} class="flow-lane flow-lane-out" />
      ))}

      {NODES.map(([x, y, c]) => (
        <g key={`${x}-${y}`}>
          <rect x={x - 9} y={y - 9} width="18" height="18" rx="5" class="flow-node" />
          <circle cx={x} cy={y} r="2.6" fill={c} />
        </g>
      ))}

      <circle cx="140" cy="42" r="34" fill={`url(#${p("core")})`} />
      <circle cx="140" cy="42" r="17" class="flow-core" />
      <circle cx="137" cy="42" r="6.2" class="flow-ring" />
      <circle cx="143" cy="42" r="6.2" class="flow-ring" />
      <path d="M140 36.6 A6.2 6.2 0 0 1 140 47.4 A6.2 6.2 0 0 1 140 36.6 Z" fill={`url(#${p("lens")})`} />

      {packets.map((k) => (
        <g key={k.path} opacity="0">
          <circle r="7" fill={`url(#${k.glow})`} />
          <circle r="2" fill={k.dot} />
          <animateMotion dur="3.2s" begin={k.begin} repeatCount="indefinite" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.4 0 0.2 1">
            <mpath href={`#${k.path}`} />
          </animateMotion>
          <animate attributeName="opacity" dur="3.2s" begin={k.begin} repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.12;0.82;1" />
        </g>
      ))}
    </svg>
  );
}
