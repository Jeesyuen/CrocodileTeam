import clsx from "clsx";
import { Clock, MapPin, Users } from "lucide-react";
import { assetUrl } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { Incident } from "@/lib/types";
import { CertaintyBadge, IncidentStatusBadge, SeverityBadge } from "./ui";

export function HazardThumb({ inc, className }: { inc: Pick<Incident, "category" | "image_url">; className?: string }) {
  const m = categoryMeta(inc.category);
  const Icon = m.icon;
  if (inc.image_url) return <img src={assetUrl(inc.image_url)} alt="" className={clsx("object-cover", className)} loading="lazy" />;
  return (
    <div className={clsx("grid place-items-center", className)} style={{ background: m.bg }} title="No photo attached">
      <Icon size={26} color={m.color} strokeWidth={2.2} />
    </div>
  );
}

export function HazardReportCard({ inc, onClick, selected }: { inc: Incident; onClick?: () => void; selected?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={clsx("flex w-full gap-3 rounded-3xl bg-white p-3 text-left ring-1 transition hover:shadow-soft",
        selected ? "ring-2 ring-lavender-deep" : "ring-line")}>
      <HazardThumb inc={inc} className="h-20 w-20 shrink-0 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="font-bold leading-snug">{inc.category_label}</span>
          <SeverityBadge s={inc.severity} />
        </div>
        <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted"><MapPin size={12} />{inc.location_label}</div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink/80">{inc.description || "No description provided."}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <CertaintyBadge c={inc.certainty} />
          <IncidentStatusBadge s={inc.status} />
          <span className="flex items-center gap-1 text-[11px] text-muted"><Clock size={11} />{timeAgo(inc.created_at)}</span>
          {inc.report_count > 1 && <span className="flex items-center gap-1 text-[11px] text-muted"><Users size={11} />{inc.report_count}</span>}
          {inc.is_synthetic && <span className="text-[10px] font-semibold text-[#9A6418]">synthetic</span>}
        </div>
      </div>
    </button>
  );
}
