/**
 * What the profile form sends to PUT /dashboard/profile. The optional fields
 * are null when left blank.
 */
export type SaveWorkerProfile = {
  slug: string;
  first_name: string;
  last_name: string;
  bio: string;
  public_email: string | null;
  public_phone: string | null;
};

/**
 * The signed-in worker's own profile, hidden or live. is_active is true once
 * their page is public.
 */
export type MyWorkerProfile = {
  slug: string;
  first_name: string;
  last_name: string;
  bio: string;
  public_email: string | null;
  public_phone: string | null;
  is_active: boolean;
};

/**
 * What the shop form sends to PUT /dashboard/join-request: the slug of the shop
 * the worker wants to join.
 */
export type JoinShop = {
  slug: string;
};

/**
 * One open day of a chair's week, in minutes after the shop's local midnight.
 * day_of_week runs 0 = Sunday to 6 = Saturday.
 */
export type ScheduleDay = {
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  break_start_minute: number | null;
  break_end_minute: number | null;
};

/**
 * What the hours form sends to PUT /dashboard/chairs/{id}/schedule: the days
 * the chair is open. A day left out is closed.
 */
export type SaveSchedule = {
  days: ScheduleDay[];
};

/**
 * A shop the signed-in worker works at, or has asked to join, with the hours
 * set there. is_active is false until the shop's owner accepts.
 */
export type MyChair = {
  id: string;
  shop: {
    slug: string;
    name: string;
  };
  is_active: boolean;
  schedule_days: ScheduleDay[];
};

/**
 * One row of the services form. id is null for a service that isn't saved yet.
 */
export type SaveService = {
  id: string | null;
  title: string;
  description: string;
  price_cents: number;
  duration_min: number;
  buffer_after_min: number;
};

/**
 * What the services form sends to PUT /dashboard/services: the whole menu. A
 * saved service left out is turned off.
 */
export type SaveServices = {
  services: SaveService[];
};

/**
 * One of the signed-in worker's offered services, as the services form edits it.
 */
export type MyService = {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  duration_min: number;
  buffer_after_min: number;
};
