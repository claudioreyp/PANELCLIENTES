import { useId, useState, type ReactNode } from "react";
import { dashboardMoney } from "../lib/dashboard";

export function ChartEmpty({ children = "No hay datos para mostrar" }: { children?: ReactNode }) {
  return <div className="dashboard-chart-empty"><span>{children}</span></div>;
}

export function LineChart({ points, label, monetary = true }: { points: { label: string; value: number }[]; label: string; monetary?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const description = useId();
  const max = Math.max(1, ...points.map((point) => Number(point.value)));
  const format = (value: number) => monetary ? dashboardMoney(value) : String(value);
  const x = (index: number) => 12 + index * 476 / Math.max(1, points.length - 1);
  const y = (value: number) => 174 - Number(value) / max * 150;
  if (!points.length) return <ChartEmpty />;
  return <div className="dashboard-line-chart">
    <div className="dashboard-chart-axis"><span>{format(Math.max(...points.map((point) => Number(point.value))))}</span><span>{format(0)}</span></div>
    <svg viewBox="0 0 500 195" preserveAspectRatio="none" role="group" aria-label={label} onMouseLeave={() => setActive(null)} onPointerDown={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      setActive(Math.max(0, Math.min(points.length - 1, Math.round((event.clientX - bounds.left) / bounds.width * (points.length - 1)))));
    }}>
      <line x1="12" x2="488" y1="174" y2="174" className="chart-baseline" />
      <polyline points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")} className="chart-series" />
      {active !== null && <line x1={x(active)} x2={x(active)} y1={20} y2={174} className="chart-guide" />}
      {points.map((point, index) => <circle key={index} cx={x(index)} cy={y(point.value)} r={active === index ? 5 : 9} tabIndex={active === index || (active === null && index === 0) ? 0 : -1} role="button" aria-label={`${point.label}: ${format(point.value)}`} aria-describedby={active === index ? description : undefined} className={active === index ? "chart-point active" : "chart-point"}
        onFocus={() => setActive(index)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
            event.currentTarget.parentElement?.querySelectorAll<SVGCircleElement>("circle")[next]?.focus();
          }
        }} />)}
    </svg>
    {active !== null && <output role="tooltip" id={description} className="dashboard-chart-tooltip" style={{ left: `${Math.max(14, Math.min(82, x(active) / 5))}%` }}>{points[active].label}<strong>{format(points[active].value)}</strong></output>}
    <div className="dashboard-chart-labels"><span>{points[0].label}</span><span>{points.at(-1)?.label}</span></div>
  </div>;
}

export function BarChart({ values, monetary = true }: { values: { name: string; value: number | null }[]; monetary?: boolean }) {
  if (!values.length) return <ChartEmpty />;
  const max = Math.max(1, ...values.map((value) => Number(value.value)));
  return <div className="dashboard-bars">{values.map((item) => <div className="dashboard-bar-column" key={item.name}>
    <div className="dashboard-bar-track" onPointerDown={(event) => event.currentTarget.querySelector<HTMLElement>("span")?.focus()}><span tabIndex={0} aria-label={`${item.name}: ${item.value === null ? "Sin días en el período" : monetary ? dashboardMoney(item.value) : item.value}`} style={{ height: `${Math.max(0, Number(item.value)) / max * 100}%` }}><i>{item.value === null ? "Sin datos" : monetary ? dashboardMoney(item.value) : item.value}</i></span></div><small>{item.name}</small>
  </div>)}</div>;
}

export function DistributionChart({ values }: { values: { name: string; value: number }[] }) {
  const total = values.reduce((sum, value) => sum + Number(value.value), 0);
  if (!total) return <ChartEmpty />;
  return <div className="dashboard-distribution">
    <div className="dashboard-distribution-track" aria-hidden="true">{values.map((item, index) => <span key={item.name} className={`chart-color-${index % 6}`} style={{ width: `${Number(item.value) / total * 100}%` }} />)}</div>
    <ul>{values.map((item, index) => <li key={item.name}><i className={`chart-color-${index % 6}`} /><span>{item.name}</span><strong>{dashboardMoney(item.value)}</strong></li>)}</ul>
  </div>;
}
