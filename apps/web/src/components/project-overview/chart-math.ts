/**
 * SVG path builders for overview charts (pure, tested through the
 * widget suites). All charts scale their data into the viewBox, so
 * rendered geometry is a pure function of server values.
 */

/** Single-series sparkline path (`M x y L …`) inside a w×h box. */
export function sparkPath(
  data: readonly number[],
  w: number,
  h: number,
  pad = 1,
): string {
  if (data.length === 0) return "";
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = data.length === 1 ? 0 : (w - pad * 2) / (data.length - 1);
  return data
    .map((value, index) => {
      const x = pad + index * step;
      const y = h - pad - ((value - min) / range) * (h - pad * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

/** X positions for n evenly spaced points across an inner width. */
export function evenXs(
  count: number,
  left: number,
  innerWidth: number,
): number[] {
  if (count <= 1) return [left];
  return Array.from(
    { length: count },
    (_, index) => left + (index / (count - 1)) * innerWidth,
  );
}
