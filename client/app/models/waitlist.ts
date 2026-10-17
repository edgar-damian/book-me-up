/**
 * What the waitlist form posts. submitted_at and received_offer are set by
 * the database, so they are not part of the request.
 */
export type JoinWaitlist = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
};
