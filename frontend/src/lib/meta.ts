import {
  AlertTriangle, Car, CloudRain, Construction, Droplets, Lightbulb, LucideIcon, Shovel, TreePine, Trash2, Waves,
} from "lucide-react";
import type { Certainty, Preference, Restriction, Severity, Status } from "./types";

export const CATEGORIES: { id: string; label: string; icon: LucideIcon; color: string; bg: string }[] = [
  { id: "fallen_tree", label: "Fallen Tree", icon: TreePine, color: "#3E9C8F", bg: "#DDF2F1" },
  { id: "flooding", label: "Flooding", icon: Waves, color: "#4A90C8", bg: "#E6F5FF" },
  { id: "pothole", label: "Pothole", icon: Shovel, color: "#B7791F", bg: "#FDEBD3" },
  { id: "damaged_pavement", label: "Damaged Pavement", icon: AlertTriangle, color: "#B7791F", bg: "#FDEBD3" },
  { id: "construction", label: "Construction", icon: Construction, color: "#D9822B", bg: "#FFE9D2" },
  { id: "road_debris", label: "Road Debris", icon: Trash2, color: "#7B8290", bg: "#EEF0F4" },
  { id: "poor_lighting", label: "Poor Lighting", icon: Lightbulb, color: "#7968C9", bg: "#E9E3FF" },
  { id: "slippery_surface", label: "Slippery Surface", icon: Droplets, color: "#4A90C8", bg: "#E6F5FF" },
  { id: "road_accident", label: "Road Accident", icon: Car, color: "#D9505A", bg: "#FDE4E6" },
  { id: "other", label: "Other", icon: CloudRain, color: "#7B8290", bg: "#EEF0F4" },
];
export const categoryMeta = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

export const SEVERITY: Record<Severity, { label: string; color: string; bg: string }> = {
  low: { label: "Low", color: "#3E9C8F", bg: "#DDF2F1" },
  medium: { label: "Medium", color: "#B7791F", bg: "#FDF1DC" },
  high: { label: "High", color: "#D9822B", bg: "#FFE6CF" },
  critical: { label: "Critical", color: "#C4444E", bg: "#FDE1E3" },
};

export const STATUS: Record<Status, { label: string; color: string; bg: string }> = {
  submitted: { label: "Submitted", color: "#7B8290", bg: "#EEF0F4" },
  pending_verification: { label: "Pending verification", color: "#B7791F", bg: "#FDF1DC" },
  verified_active: { label: "Verified · Active", color: "#C4444E", bg: "#FDE4E6" },
  in_progress: { label: "In progress", color: "#4A90C8", bg: "#E6F5FF" },
  awaiting_clearance: { label: "Awaiting clearance", color: "#7968C9", bg: "#E9E3FF" },
  resolved: { label: "Resolved", color: "#3E9C8F", bg: "#DDF2F1" },
  rejected: { label: "Rejected", color: "#7B8290", bg: "#EEF0F4" },
  duplicate: { label: "Duplicate", color: "#7B8290", bg: "#EEF0F4" },
  expired_review: { label: "Expired — review", color: "#B7791F", bg: "#FDF1DC" },
};
export const LIFECYCLE: Status[] = ["submitted", "pending_verification", "verified_active", "in_progress",
  "awaiting_clearance", "resolved"];

export const CERTAINTY: Record<Certainty, { label: string; hint: string; color: string; bg: string }> = {
  reported: { label: "Unverified report", hint: "Reported by the community — not yet checked by an operator.", color: "#B7791F", bg: "#FDF1DC" },
  verified: { label: "Verified hazard", hint: "Confirmed by a safety operator.", color: "#D9822B", bg: "#FFE6CF" },
  confirmed_closure: { label: "Confirmed closure", hint: "An operator confirmed this path is closed. Routes avoid it.", color: "#C4444E", bg: "#FDE1E3" },
  resolved: { label: "Resolved", hint: "Cleared and closed by an operator.", color: "#3E9C8F", bg: "#DDF2F1" },
  rejected: { label: "Rejected", hint: "An operator found no hazard.", color: "#7B8290", bg: "#EEF0F4" },
  duplicate: { label: "Duplicate", hint: "Merged into another report.", color: "#7B8290", bg: "#EEF0F4" },
};

export const RESTRICTION: Record<Restriction, string> = {
  none: "No restriction", advisory: "Provisional warning", caution: "Verified — use caution", closed: "Closed",
};

export const ROUTE_STYLE: Record<Preference | "usual", { color: string; soft: string; label: string }> = {
  safest: { color: "#3FAE97", soft: "#DDF2F1", label: "Safest" },
  balanced: { color: "#7968C9", soft: "#E9E3FF", label: "Smart Balance" },
  fastest: { color: "#4A90C8", soft: "#E6F5FF", label: "Fastest" },
  usual: { color: "#9AA1AD", soft: "#EEF0F4", label: "Usual" },
};

export const CONGESTION: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: "#58B99B" },
  moderate: { label: "Moderate", color: "#E8C547" },
  high: { label: "High", color: "#F09A4A" },
  severe: { label: "Severe", color: "#E2545E" },
};

export const PRIORITY: Record<string, { color: string; bg: string }> = {
  critical: { color: "#C4444E", bg: "#FDE1E3" },
  high: { color: "#D9822B", bg: "#FFE6CF" },
  medium: { color: "#7968C9", bg: "#E9E3FF" },
  low: { color: "#3E9C8F", bg: "#DDF2F1" },
};

export const ROLE_LABEL: Record<string, string> = {
  student: "Student", driver: "Driver", operator: "Safety Operator", maintenance: "Maintenance",
};
