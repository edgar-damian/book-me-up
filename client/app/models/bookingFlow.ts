/**
 * The shop being booked at, for the page heading and footer.
 */
export type Establishment = {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  email: string | null;
};

/**
 * Dates on which at least one bookable slot exists for a given service.
 */
export type DatesAvailable = {
  timezone: string;
  window_start: string;
  window_end: string;
  dates: string[];
  service_title: string;
  worker_name: string;
  worker_slug: string;
  establishment: Establishment;
};

/**
 * One bookable appointment, as absolute instants. `end_time` is the
 * client-facing end (start + duration_min)
 */
export type ValidSlot = {
  start_time: string;
  end_time: string;
};

/**
 * Step 2 of the booking flow, a client picked a date. We now
 * show them a list of ValidSlots for them to choose form.
 */
export type TimesAvailable = {
  timezone: string;
  day_chose: string;
  valid_slots: ValidSlot[];
};

/**
 * What a brand new booking can be. ACCEPTED when the worker auto accepts,
 * otherwise PENDING until they answer.
 */
export type BookingStatus = "PENDING" | "ACCEPTED";

/**
 * What the booking form collects. No id on purpose, guests never get a
 * Client row and linking one is ours to decide, not the caller's.
 */
export type Client = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
};

/**
 * Step 3A of the booking, a client will build this and hand this
 * to us. We then make to make the Appointment row to save their spot
 */
export type BookAppointment = {
  client: Client;
  starts_at: string;
  notes: string | null;
  service_id: string;
  worker_id: string;
  establishment_id: string;
};

/**
 * Step 3B result, what actually got saved. The frontend keys its message off
 * status: ACCEPTED is booked, PENDING is held until hold_expires_at.
 */
export type AppointmentBooked = {
  id: string;
  status: BookingStatus;
  timezone: string;
  starts_at: string;
  ends_at: string;
  service_title: string;
  price_cents: number;
  hold_expires_at: string | null;
};
