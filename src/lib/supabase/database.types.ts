/**
 * Database types.
 *
 * Hand-authored to mirror `supabase/migrations/*.sql` exactly. Regenerate with
 *   supabase gen types typescript --local > src/lib/supabase/database.types.ts
 * after any migration; the shape below is what that command produces, written
 * out so the repository type-checks without a running database.
 *
 * `Insert` and `Update` are derived from `Row` rather than repeated by hand:
 * every column with a DEFAULT is optional on insert, and everything is optional
 * on update. Listing the genuinely-required columns per table is the only part
 * that needs human judgement, so it is the only part written out.
 */

import type {
  AccountStatus,
  AnomalyKind,
  AnomalyReviewStatus,
  AnomalySeverity,
  AppLocale,
  AppRole,
  AttendanceMethod,
  AttendanceType,
  BusStatus,
  CaptureKind,
  ConfidenceBand,
  DashboardType,
  EmployeeType,
  EmploymentStatus,
  FuelType,
  LivenessResult,
  NotificationKind,
  NotificationSeverity,
  ReadingField,
  ReadingSource,
  RouteStatus,
  TripStatus,
} from '@domain/types.ts';

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/**
 * NOTE ON `type` VS `interface` BELOW
 *
 * Every row shape is a `type` alias rather than an `interface`, and that is not
 * a style preference. supabase-js constrains each table to
 * `{ Row: Record<string, unknown>; … }`, and TypeScript only grants an implicit
 * index signature to object *type aliases* — an `interface` fails the
 * constraint, which makes the whole schema fall back to `never` and silently
 * un-types every query in the application.
 */

/** Columns that must be supplied; everything else has a database default. */
type Insertable<Row, Required extends keyof Row> = Pick<Row, Required> &
  Partial<Omit<Row, Required>>;

/**
 * Marks a table as not writable from the browser.
 *
 * `never` would be the natural spelling, but supabase-js constrains every
 * table's Insert/Update to `Record<string, unknown>`, and a `never` there makes
 * the whole schema fail that constraint — which silently degrades *every*
 * query in the application to `never`. An empty object type expresses the same
 * intent (no property can be supplied) while keeping the schema valid.
 */
type NotWritable = Record<string, never>;

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  contact_email: string | null;
  contact_phone: string | null;
  timezone: string;
  default_locale: AppLocale;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
};

export type DepotRow = {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  address_line: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  deactivated_at: string | null;
};

export type ProfileRow = {
  id: string;
  organization_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  status: AccountStatus;
  preferred_locale: AppLocale | null;
  avatar_path: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  deactivated_at: string | null;
};

export type UserRoleRow = {
  id: string;
  user_id: string;
  organization_id: string;
  role: AppRole;
  granted_by: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type ManagerDepotRow = {
  id: string;
  user_id: string;
  organization_id: string;
  depot_id: string;
  assigned_by: string | null;
  created_at: string;
  unassigned_at: string | null;
};

export type BusRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  registration_number: string;
  fleet_number: string | null;
  make: string | null;
  model: string | null;
  manufacturing_year: number | null;
  fuel_type: FuelType;
  dashboard_type: DashboardType;
  tank_capacity_litres: number | null;
  nominal_efficiency_kmpl: number | null;
  baseline_efficiency_kmpl: number | null;
  starting_odometer_km: number;
  current_odometer_km: number;
  status: BusStatus;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  deactivated_at: string | null;
};

export type RouteRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  name: string;
  code: string;
  origin: string;
  destination: string;
  expected_distance_km: number;
  distance_tolerance_pct: number;
  typical_duration_minutes: number | null;
  status: RouteStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  deactivated_at: string | null;
};

export type RouteStopRow = {
  id: string;
  organization_id: string;
  route_id: string;
  sequence_no: number;
  name: string;
  distance_from_origin_km: number | null;
  created_at: string;
};

export type EmployeeRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  employee_code: string;
  full_name: string;
  employee_type: EmployeeType;
  phone: string | null;
  employment_status: EmploymentStatus;
  joining_date: string | null;
  licence_number: string | null;
  licence_expiry: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  deactivated_at: string | null;
};

export type BiometricConsentRow = {
  id: string;
  organization_id: string;
  employee_id: string;
  notice_version: string;
  acknowledged_by: string;
  acknowledged_at: string;
  photo_retention_days: number;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
};

export type EmployeePhotoRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  employee_id: string;
  storage_provider: string;
  storage_bucket: string;
  storage_path: string;
  content_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  quality_score: number | null;
  pose_hint: string | null;
  captured_by: string | null;
  created_at: string;
  purged_at: string | null;
};

export type FaceEmbeddingRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  employee_id: string;
  photo_id: string | null;
  provider: string;
  model_version: string;
  dimensions: number;
  embedding: number[];
  quality_score: number | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

export type DriverAssignmentRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  employee_id: string;
  bus_id: string | null;
  route_id: string | null;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  created_by: string | null;
};

export type TripRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  bus_id: string;
  route_id: string;
  driver_id: string | null;
  manager_id: string | null;
  status: TripStatus;
  planned_start_time: string | null;
  actual_start_time: string | null;
  actual_end_time: string | null;
  expected_distance_km: number;
  distance_tolerance_pct: number;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
  start_range_km: number | null;
  end_range_km: number | null;
  start_fuel_percent: number | null;
  end_fuel_percent: number | null;
  refuel_litres: number | null;
  start_capture_id: string | null;
  end_capture_id: string | null;
  calculated_distance_km: number | null;
  distance_variance_km: number | null;
  distance_variance_pct: number | null;
  calculated_efficiency_kmpl: number | null;
  duration_minutes: number | null;
  anomaly_score: number;
  review_status: AnomalyReviewStatus;
  completion_override: boolean;
  completion_override_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

export type AttendanceRecordRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  employee_id: string;
  manager_id: string;
  route_id: string | null;
  bus_id: string | null;
  trip_id: string | null;
  attendance_type: AttendanceType;
  attendance_date: string;
  recorded_at: string;
  method: AttendanceMethod;
  face_match_score: number | null;
  face_match_threshold: number | null;
  recognition_provider: string | null;
  recognition_model_version: string | null;
  liveness: LivenessResult;
  liveness_score: number | null;
  manual_override: boolean;
  override_reason_code: string | null;
  override_reason: string | null;
  device_metadata: Json;
  created_at: string;
};

export type DashboardCaptureRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  bus_id: string;
  trip_id: string | null;
  kind: CaptureKind;
  storage_provider: string;
  storage_bucket: string;
  storage_path: string;
  content_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  image_hash: string | null;
  captured_at: string;
  captured_by: string;
  ocr_provider: string | null;
  ocr_engine_version: string | null;
  ocr_status: string;
  ocr_duration_ms: number | null;
  ocr_raw_response: Json | null;
  preprocessing: Json;
  created_at: string;
  purged_at: string | null;
};

export type DashboardReadingRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  capture_id: string;
  trip_id: string | null;
  field: ReadingField;
  ocr_text: string | null;
  ocr_value: number | null;
  ocr_confidence: number | null;
  confidence_band: ConfidenceBand | null;
  final_value: number | null;
  source: ReadingSource;
  was_corrected: boolean;
  corrected_by: string | null;
  corrected_at: string | null;
  created_at: string;
};

export type FuelEntryRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  bus_id: string;
  trip_id: string | null;
  filled_at: string;
  litres: number;
  cost_amount: number | null;
  currency: string;
  odometer_km: number | null;
  is_full_tank: boolean;
  vendor: string | null;
  reference_no: string | null;
  notes: string | null;
  recorded_by: string;
  created_at: string;
};

export type AnomalyRow = {
  id: string;
  organization_id: string;
  depot_id: string;
  trip_id: string | null;
  bus_id: string | null;
  driver_id: string | null;
  route_id: string | null;
  capture_id: string | null;
  kind: AnomalyKind;
  severity: AnomalySeverity;
  score: number;
  observed_value: number | null;
  expected_value: number | null;
  variance_pct: number | null;
  unit: string | null;
  rule_code: string;
  rule_version: number;
  threshold_snapshot: Json;
  detail: Json;
  review_status: AnomalyReviewStatus;
  resolved_at: string | null;
  resolved_by: string | null;
  detected_at: string;
  created_at: string;
  updated_at: string;
};

export type AnomalyReviewRow = {
  id: string;
  organization_id: string;
  anomaly_id: string;
  previous_status: AnomalyReviewStatus | null;
  new_status: AnomalyReviewStatus;
  notes: string | null;
  reviewed_by: string;
  reviewed_at: string;
};

export type BusBaselineRow = {
  id: string;
  organization_id: string;
  bus_id: string;
  route_id: string | null;
  sample_size: number;
  median_efficiency_kmpl: number | null;
  mad_efficiency_kmpl: number | null;
  median_range_drop_per_km: number | null;
  mad_range_drop_per_km: number | null;
  median_distance_km: number | null;
  window_start: string | null;
  window_end: string | null;
  computed_at: string;
};

export type AuditLogRow = {
  id: number;
  organization_id: string | null;
  depot_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: AppRole | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  before_values: Json | null;
  after_values: Json | null;
  context: Json;
  occurred_at: string;
};

export type AppSettingsRow = {
  organization_id: string;
  distance_tolerance_pct: number;
  efficiency_drop_tolerance_pct: number;
  range_drop_tolerance_pct: number;
  min_trips_for_baseline: number;
  baseline_window_days: number;
  face_auto_accept_similarity: number;
  face_review_similarity: number;
  face_min_quality: number;
  face_require_liveness: boolean;
  face_min_enrolment_photos: number;
  ocr_high_confidence: number;
  ocr_medium_confidence: number;
  photo_retention_days: number;
  dashboard_capture_retention_days: number;
  attendance_retention_days: number;
  anomaly_rules: Json;
  updated_at: string;
  updated_by: string | null;
};

export type UserPreferencesRow = {
  user_id: string;
  locale: AppLocale | null;
  theme: 'light' | 'dark' | 'system';
  default_depot_id: string | null;
  dense_tables: boolean;
  reduce_motion: boolean;
  updated_at: string;
};

export type NotificationRow = {
  id: string;
  organization_id: string;
  depot_id: string | null;
  recipient_id: string | null;
  recipient_role: AppRole | null;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title_key: string;
  body_key: string;
  payload: Json;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
  expires_at: string | null;
};

export type AnalyticsEventRow = {
  id: number;
  organization_id: string | null;
  depot_id: string | null;
  user_id: string | null;
  name: string;
  properties: Json;
  app_version: string | null;
  locale: AppLocale | null;
  occurred_at: string;
};

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: OrganizationRow;
        Insert: Insertable<OrganizationRow, 'name' | 'slug'>;
        Update: Partial<OrganizationRow>;
        Relationships: [];
      };
      depots: {
        Row: DepotRow;
        Insert: Insertable<DepotRow, 'organization_id' | 'name' | 'code'>;
        Update: Partial<DepotRow>;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: Insertable<ProfileRow, 'id' | 'email'>;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      user_roles: {
        Row: UserRoleRow;
        Insert: Insertable<UserRoleRow, 'user_id' | 'organization_id' | 'role'>;
        Update: Partial<UserRoleRow>;
        Relationships: [];
      };
      manager_depots: {
        Row: ManagerDepotRow;
        Insert: Insertable<ManagerDepotRow, 'user_id' | 'organization_id' | 'depot_id'>;
        Update: Partial<ManagerDepotRow>;
        Relationships: [];
      };
      buses: {
        Row: BusRow;
        Insert: Insertable<BusRow, 'organization_id' | 'depot_id' | 'registration_number'>;
        Update: Partial<BusRow>;
        Relationships: [];
      };
      routes: {
        Row: RouteRow;
        Insert: Insertable<
          RouteRow,
          | 'organization_id'
          | 'depot_id'
          | 'name'
          | 'code'
          | 'origin'
          | 'destination'
          | 'expected_distance_km'
        >;
        Update: Partial<RouteRow>;
        Relationships: [];
      };
      route_stops: {
        Row: RouteStopRow;
        Insert: Insertable<RouteStopRow, 'organization_id' | 'route_id' | 'sequence_no' | 'name'>;
        Update: Partial<RouteStopRow>;
        Relationships: [];
      };
      employees: {
        Row: EmployeeRow;
        Insert: Insertable<
          EmployeeRow,
          'organization_id' | 'depot_id' | 'employee_code' | 'full_name'
        >;
        Update: Partial<EmployeeRow>;
        Relationships: [];
      };
      biometric_consents: {
        Row: BiometricConsentRow;
        Insert: Insertable<
          BiometricConsentRow,
          'organization_id' | 'employee_id' | 'notice_version' | 'acknowledged_by'
        >;
        Update: Partial<BiometricConsentRow>;
        Relationships: [];
      };
      employee_photos: {
        Row: EmployeePhotoRow;
        Insert: Insertable<
          EmployeePhotoRow,
          | 'organization_id'
          | 'depot_id'
          | 'employee_id'
          | 'storage_bucket'
          | 'storage_path'
          | 'byte_size'
        >;
        Update: Partial<EmployeePhotoRow>;
        Relationships: [];
      };
      face_embeddings: {
        Row: FaceEmbeddingRow;
        Insert: Insertable<
          FaceEmbeddingRow,
          | 'organization_id'
          | 'depot_id'
          | 'employee_id'
          | 'provider'
          | 'model_version'
          | 'dimensions'
          | 'embedding'
        >;
        Update: Partial<FaceEmbeddingRow>;
        Relationships: [];
      };
      driver_assignments: {
        Row: DriverAssignmentRow;
        Insert: Insertable<DriverAssignmentRow, 'organization_id' | 'depot_id' | 'employee_id'>;
        Update: Partial<DriverAssignmentRow>;
        Relationships: [];
      };
      trips: {
        Row: TripRow;
        Insert: Insertable<
          TripRow,
          'organization_id' | 'depot_id' | 'bus_id' | 'route_id' | 'expected_distance_km'
        >;
        Update: Partial<TripRow>;
        Relationships: [];
      };
      attendance_records: {
        Row: AttendanceRecordRow;
        Insert: Insertable<
          AttendanceRecordRow,
          'organization_id' | 'depot_id' | 'employee_id' | 'manager_id' | 'method'
        >;
        Update: Partial<AttendanceRecordRow>;
        Relationships: [];
      };
      dashboard_captures: {
        Row: DashboardCaptureRow;
        Insert: Insertable<
          DashboardCaptureRow,
          | 'organization_id'
          | 'depot_id'
          | 'bus_id'
          | 'kind'
          | 'storage_bucket'
          | 'storage_path'
          | 'byte_size'
          | 'captured_by'
        >;
        Update: Partial<DashboardCaptureRow>;
        Relationships: [];
      };
      dashboard_readings: {
        Row: DashboardReadingRow;
        Insert: Insertable<
          DashboardReadingRow,
          'organization_id' | 'depot_id' | 'capture_id' | 'field' | 'source'
        >;
        Update: Partial<DashboardReadingRow>;
        Relationships: [];
      };
      fuel_entries: {
        Row: FuelEntryRow;
        Insert: Insertable<
          FuelEntryRow,
          'organization_id' | 'depot_id' | 'bus_id' | 'litres' | 'recorded_by'
        >;
        Update: Partial<FuelEntryRow>;
        Relationships: [];
      };
      anomalies: {
        Row: AnomalyRow;
        Insert: Insertable<
          AnomalyRow,
          'organization_id' | 'depot_id' | 'kind' | 'severity' | 'rule_code'
        >;
        Update: Partial<AnomalyRow>;
        Relationships: [];
      };
      anomaly_reviews: {
        Row: AnomalyReviewRow;
        Insert: Insertable<
          AnomalyReviewRow,
          'organization_id' | 'anomaly_id' | 'new_status' | 'reviewed_by'
        >;
        Update: NotWritable;
        Relationships: [];
      };
      bus_baselines: {
        Row: BusBaselineRow;
        Insert: Insertable<BusBaselineRow, 'organization_id' | 'bus_id'>;
        Update: Partial<BusBaselineRow>;
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLogRow;
        Insert: NotWritable;
        Update: NotWritable;
        Relationships: [];
      };
      app_settings: {
        Row: AppSettingsRow;
        Insert: Insertable<AppSettingsRow, 'organization_id'>;
        Update: Partial<AppSettingsRow>;
        Relationships: [];
      };
      user_preferences: {
        Row: UserPreferencesRow;
        Insert: Insertable<UserPreferencesRow, 'user_id'>;
        Update: Partial<UserPreferencesRow>;
        Relationships: [];
      };
      notifications: {
        Row: NotificationRow;
        Insert: Insertable<NotificationRow, 'organization_id' | 'kind' | 'title_key' | 'body_key'>;
        Update: Partial<NotificationRow>;
        Relationships: [];
      };
      analytics_events: {
        Row: AnalyticsEventRow;
        Insert: Insertable<AnalyticsEventRow, 'name'>;
        Update: NotWritable;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      rpc_record_attendance: {
        Args: {
          p_employee_id: string;
          p_depot_id: string;
          p_route_id: string | null;
          p_bus_id: string | null;
          p_method: AttendanceMethod;
          p_attendance_type?: AttendanceType;
          p_trip_id?: string | null;
          p_face_score?: number | null;
          p_face_threshold?: number | null;
          p_provider?: string | null;
          p_model_version?: string | null;
          p_liveness?: LivenessResult;
          p_liveness_score?: number | null;
          p_override_reason_code?: string | null;
          p_override_reason?: string | null;
          p_device_metadata?: Json;
        };
        Returns: AttendanceRecordRow;
      };
      rpc_start_trip: {
        Args: {
          p_bus_id: string;
          p_route_id: string;
          p_driver_id: string | null;
          p_start_odometer: number;
          p_start_range?: number | null;
          p_start_fuel_percent?: number | null;
          p_capture_id?: string | null;
          p_planned_start?: string | null;
        };
        Returns: TripRow;
      };
      rpc_complete_trip: {
        Args: {
          p_trip_id: string;
          p_end_odometer: number | null;
          p_end_range?: number | null;
          p_end_fuel_percent?: number | null;
          p_refuel_litres?: number | null;
          p_capture_id?: string | null;
          p_override?: boolean;
          p_override_reason?: string | null;
        };
        Returns: TripRow;
      };
      rpc_face_candidates: {
        Args: {
          p_depot_id: string;
          p_route_id?: string | null;
          p_bus_id?: string | null;
          p_limit?: number;
        };
        Returns: Array<{
          employee_id: string;
          employee_code: string;
          full_name: string;
          is_assigned: boolean;
          embedding_id: string;
          model_version: string;
          provider: string;
          dimensions: number;
          embedding: number[];
          quality_score: number | null;
        }>;
      };
      rpc_recompute_bus_baseline: {
        Args: { p_bus_id: string; p_route_id?: string | null };
        Returns: BusBaselineRow;
      };
      rpc_search: {
        Args: { p_query: string; p_limit?: number };
        Returns: Array<{
          kind: 'bus' | 'employee' | 'route' | 'manager';
          id: string;
          title: string;
          subtitle: string;
          depot_id: string | null;
        }>;
      };
      rpc_manager_dashboard: { Args: { p_depot_id?: string | null }; Returns: Json };
      rpc_admin_dashboard: { Args: { p_days?: number }; Returns: Json };
      rpc_delete_biometric_data: {
        Args: { p_employee_id: string; p_reason: string };
        Returns: Json;
      };
      fn_org_today: { Args: { p_org?: string | null }; Returns: string };
      auth_role: { Args: Record<string, never>; Returns: AppRole | null };
      auth_org_id: { Args: Record<string, never>; Returns: string | null };
    };
    Enums: {
      app_role: AppRole;
      account_status: AccountStatus;
      app_locale: AppLocale;
      employee_type: EmployeeType;
      employment_status: EmploymentStatus;
      fuel_type: FuelType;
      bus_status: BusStatus;
      dashboard_type: DashboardType;
      route_status: RouteStatus;
      trip_status: TripStatus;
      attendance_type: AttendanceType;
      attendance_method: AttendanceMethod;
      liveness_result: LivenessResult;
      capture_kind: CaptureKind;
      reading_field: ReadingField;
      reading_source: ReadingSource;
      confidence_band: ConfidenceBand;
      anomaly_kind: AnomalyKind;
      anomaly_severity: AnomalySeverity;
      anomaly_review_status: AnomalyReviewStatus;
      notification_kind: NotificationKind;
      notification_severity: NotificationSeverity;
    };
    CompositeTypes: { [_ in never]: never };
  };
}

export type TableName = keyof Database['public']['Tables'];
export type Row<T extends TableName> = Database['public']['Tables'][T]['Row'];
export type Insert<T extends TableName> = Database['public']['Tables'][T]['Insert'];
export type Update<T extends TableName> = Database['public']['Tables'][T]['Update'];
