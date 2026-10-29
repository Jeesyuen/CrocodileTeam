export type Role = "student" | "driver" | "operator" | "maintenance";
export type Mode = "walk" | "drive";
export type Preference = "fastest" | "safest" | "balanced";
export type Severity = "low" | "medium" | "high" | "critical";
export type Weather = "auto" | "clear" | "rain";
export type LatLon = { lat: number; lon: number; label?: string | null };

export interface User { id: number; name: string; email: string; role: Role; avatar_color: string }

export interface Place { id: string; name: string; kind: string; lat: number; lon: number }

export interface SafetyFactor { factor: string; label: string; risk: number; weight: number; contribution: number; known_share: number }
export interface Safety {
  score: number; risk_level: "low" | "moderate" | "elevated"; factors: SafetyFactor[];
  data_confidence: number; confidence_label: "high" | "medium" | "low"; lit_share: number;
  conditions: { rain: boolean; night: boolean };
}
export interface CongestionSpan { level: "moderate" | "high" | "severe"; geometry: [number, number][]; road: string | null; predicted: boolean }
export interface Route {
  preference: Preference | "usual"; label: string; same_as: Preference | null;
  edge_ids: string[]; segment_ids: string[]; geometry: [number, number][];
  distance_m: number; duration_s: number; free_flow_duration_s: number | null; delay_s: number | null;
  arrival: string; safety: Safety; hazard_ids: number[]; congestion: CongestionSpan[]; via: string[]; explanation: string;
}
export interface RoutePlan {
  mode: Mode; routes: Route[]; usual: Route | null; recommended: Preference; depart: string;
  access: { origin: { from: number[]; to: number[]; distance_m: number }; destination: { from: number[]; to: number[]; distance_m: number } };
  conditions: { rain: boolean; night: boolean; weather_source: string }; traffic_data: string | null;
}

export type Status = "submitted" | "pending_verification" | "verified_active" | "in_progress" | "awaiting_clearance"
  | "resolved" | "rejected" | "duplicate" | "expired_review";
export type Restriction = "none" | "advisory" | "caution" | "closed";
export type Certainty = "reported" | "verified" | "confirmed_closure" | "resolved" | "rejected" | "duplicate";

export interface Incident {
  id: number; category: string; category_label: string; title: string; description: string; severity: Severity;
  status: Status; restriction: Restriction; obstruction: string; lat: number; lon: number; location_label: string;
  mode_relevance: "walk" | "drive" | "both"; match_quality: "reliable" | "approximate" | "none"; report_count: number;
  is_synthetic: boolean; created_at: string; updated_at: string; resolved_at: string | null; image_url: string | null;
  reporter_id: number | null; certainty: Certainty;
}
export interface AIResult {
  status: "ok" | "uncertain" | "unavailable" | "error"; model: string | null; message: string;
  result: null | {
    is_hazard_photo: boolean; hazard_type: string; severity: Severity; possible_blockage: string;
    affects: string; description: string; confidence: number; requires_verification: boolean;
  };
}
export interface IncidentDetail extends Incident {
  images: string[];
  impacts: { network: Mode; segment_id: string; impact_type: string; distance_m: number; active: boolean }[];
  affected_paths: { network: Mode; impact_type: string; active: boolean; road: string | null; geometry: [number, number][] }[];
  history: { action: string; from: string | null; to: string | null; note: string; actor: string; actor_role: Role | null; at: string }[];
  reports: { id: number; reporter: string | null; category: string; severity: Severity; description: string; created_at: string;
    images: string[]; ai: { model: string; status: string; output: AIResult; confidence: number | null; created_at: string }[] }[];
}

export interface Notification {
  id: number; kind: string; priority: "low" | "medium" | "high" | "critical"; title: string; message: string;
  incident_id: number | null; data: Record<string, unknown>; created_at: string; read_at: string | null;
}

export interface RouteSession {
  id: number; mode: Mode; preference: Preference; origin: LatLon; destination: LatLon;
  edge_ids: string[]; segment_ids: string[]; active: boolean;
}

export interface Task {
  id: number; status: "assigned" | "in_progress" | "awaiting_clearance" | "closed"; priority: Severity;
  instructions: string; resolution_notes: string; created_at: string; updated_at: string; completed_at: string | null;
  assignee: { id: number; name: string }; completion_image_url: string | null; incident: Incident;
}

export interface DataSource { type: string; label: string; note: string }
export interface SegmentForecast {
  horizon_min: number; target_time: string; ratio: number; speed_kmh: number; travel_time_s: number;
  delay_s: number; level: "low" | "moderate" | "high" | "severe"; uncertainty: number; method: string;
}
export interface TrafficForecast {
  generated_at: string; reference_time: string; weather: Weather; model_version: string; data_source: DataSource;
  summary: {
    current_level: string; current_avg_ratio: number;
    predicted_peak: { time: string; level: string; avg_ratio: number };
    avg_forecast_delay_s: number; congested_segments_30: number; segments_total: number; incident_segments: string[];
  };
  outlook: { time: string; avg_ratio: number; level: string; congested_segments: number; total_delay_s: number }[];
  segments: { id: string; name: string; highway: string; free_flow_kmh: number; length_m: number; incident: boolean; forecasts: SegmentForecast[] }[];
}
export interface TrafficPrediction extends RoutePlan {
  timeline: { depart: string; duration_s: number; free_flow_s: number; delay_s: number }[];
  insights: { type: string; text: string }[]; data_source: DataSource; model_version: string;
}
export interface BestDeparture {
  options: { depart: string; arrival: string; duration_s: number; delay_s: number; on_time: boolean; via: string[] }[];
  recommended: BestDeparture["options"][number]; verdict: "ok" | "late"; saving_vs_now_s: number; insight: string;
  arrive_by: string | null; data_source: DataSource; model_version: string;
}
