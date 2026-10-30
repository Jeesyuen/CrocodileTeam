import clsx from "clsx";
import { Info, LucideIcon, Sparkles, X } from "lucide-react";
import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { CERTAINTY, SEVERITY, STATUS } from "@/lib/meta";
import type { Certainty, Severity, Status } from "@/lib/types";
import { Cone } from "./Illustrations";

export function StatCard({ label, value, icon: Icon, tone = "lavender", hint, onClick }: {
  label: string; value: ReactNode; icon: LucideIcon; tone?: "lavender" | "mint" | "sky" | "peach" | "rose"; hint?: string;
  onClick?: () => void;
}) {
  const tones = {
    lavender: "bg-lavender text-lavender-deep", mint: "bg-mint text-mint-deep", sky: "bg-sky text-sky-deep",
    peach: "bg-peach text-[#B7791F]", rose: "bg-[#FDE4E6] text-[#C4444E]",
  };
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className="card card-pad flex h-full items-center gap-4 text-left transition enabled:hover:-translate-y-0.5 enabled:hover:shadow-float disabled:cursor-default animate-rise">
      <span className={clsx("grid h-12 w-12 shrink-0 place-items-center rounded-2xl", tones[tone])}>
        <Icon size={22} strokeWidth={2.2} />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-extrabold leading-tight">{value}</span>
        <span className="block text-sm leading-snug text-muted">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-muted/80">{hint}</span>}
      </span>
    </button>
  );
}

export function Pill({ color, bg, children, className, title }: { color: string; bg: string; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={clsx("chip", className)} style={{ color, background: bg }}>{children}</span>;
}

export const SeverityBadge = ({ s }: { s: Severity }) => (
  <Pill color={SEVERITY[s].color} bg={SEVERITY[s].bg}><span className="h-1.5 w-1.5 rounded-full" style={{ background: SEVERITY[s].color }} />{SEVERITY[s].label}</Pill>
);
export const IncidentStatusBadge = ({ s }: { s: Status }) => <Pill color={STATUS[s].color} bg={STATUS[s].bg}>{STATUS[s].label}</Pill>;
export const CertaintyBadge = ({ c }: { c: Certainty }) => (
  <Pill color={CERTAINTY[c].color} bg={CERTAINTY[c].bg} title={CERTAINTY[c].hint}>{CERTAINTY[c].label}</Pill>
);

export function SafetyScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const color = score >= 82 ? "#3FAE97" : score >= 65 ? "#E3A53F" : "#E2545E";
  const dim = { sm: 40, md: 54, lg: 78 }[size];
  const r = dim / 2 - 4, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: dim, height: dim }} title="Estimated safety score (heuristic)">
      <svg width={dim} height={dim} className="-rotate-90">
        <circle cx={dim / 2} cy={dim / 2} r={r} fill="none" stroke="#EEF0F4" strokeWidth={5} />
        <circle cx={dim / 2} cy={dim / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className={clsx("absolute inset-0 grid place-items-center font-extrabold", size === "lg" ? "text-xl" : size === "sm" ? "text-xs" : "text-sm")}>{score}</span>
    </div>
  );
}

export function SyntheticBadge({ label = "Synthetic demo data", note }: { label?: string; note?: string }) {
  return (
    <span className="chip bg-peach text-[#9A6418]" title={note}>
      <Info size={12} /> {label}
    </span>
  );
}

export function AIInsightCard({ title = "AI Insight", children, tone = "lavender", footer }: {
  title?: string; children: ReactNode; tone?: "lavender" | "mint"; footer?: ReactNode;
}) {
  return (
    <div className={clsx("relative overflow-hidden rounded-3xl p-5", tone === "lavender" ? "bg-lavender" : "bg-mint")}>
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/40" />
      <div className="relative flex items-center gap-2 text-sm font-bold text-lavender-deep">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/70"><Sparkles size={16} /></span>{title}
      </div>
      <div className="relative mt-3 space-y-2 text-[15px] leading-relaxed text-ink">{children}</div>
      {footer && <div className="relative mt-3">{footer}</div>}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <Cone className="h-24 w-24" />
      <h3 className="mt-3 text-base font-bold">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={clsx("animate-pulse rounded-2xl bg-line", className)} />
);
export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>;
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#FDE4E6] px-4 py-3 text-sm text-[#A8343E]">
      <span>{message}</span>
      {onRetry && <button className="font-semibold underline" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Modal({ open, onClose, children, title, wide }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-ink/25 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal className={clsx("max-h-[92vh] w-full overflow-y-auto rounded-t-4xl bg-white p-6 shadow-float animate-rise sm:rounded-4xl scroll-thin", wide ? "sm:max-w-3xl" : "sm:max-w-md")}
        onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="btn-ghost -mr-2 -mt-1 h-9 w-9 !p-0" aria-label="Close"><X size={18} /></button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1100] flex justify-end bg-ink/20 backdrop-blur-[2px]" onClick={onClose}>
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-canvas shadow-float animate-rise scroll-thin sm:rounded-l-4xl"
        onClick={(e) => e.stopPropagation()}>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

export function ConfirmationDialog({ open, title, text, confirmLabel = "Confirm", danger, onConfirm, onClose, children, busy }: {
  open: boolean; title: string; text?: string; confirmLabel?: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onClose: () => void; children?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {text && <p className="text-sm text-muted">{text}</p>}
      {children}
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</button>
      </div>
    </Modal>
  );
}

export function SectionHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function PageHeader({ title, subtitle, right, eyebrow }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1">{eyebrow}</div>}
        <h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted sm:text-base">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Avatar({ name, color, size = 36 }: { name: string; color?: string; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="grid shrink-0 place-items-center rounded-2xl font-bold text-lavender-deep"
      style={{ width: size, height: size, background: color ?? "#E9E3FF", fontSize: size * 0.36 }}>{initials}</span>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string;
}) {
  return (
    <div className={clsx("seg", className)} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} data-on={value === o.value}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
