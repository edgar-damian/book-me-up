export type Services = {
  id: string;
  worker_id: string;
  title: string;
  description: string;
  image: string | null;
  price_cents: number;
  duration_min: number;
  is_active: boolean;
};

export type Establishment = {
  id: string;
  slug: string;
  name: string;
  city: string;
  timezone: string;
};

export type Day = {
  day_of_week: number;
  start_minute: number;
  end_minute: number;
};

export type Chair = {
  id: string;
  establishment: Establishment;
  schedule_days: Day[];
};

export type WorkerLandingPage = {
  id: string;
  slug: string;
  first_name: string;
  last_name: string;
  bio: string;
  public_email: string | null;
  public_phone: string | null;
  image: string | null;
  is_active: boolean;
  hold_expiry_hours: number;
  auto_accept: boolean;
  min_lead_time_min: number;
  max_advance_days: number;
  cancellation_cutoff_min: number;
  services: Services[];
  chairs: Chair[];
};
