/**
 * What the login form posts.
 */
export type LogIn = {
  email: string;
  password: string;
};

/**
 * A Supabase session trimmed to what the client stores. expires_at is unix
 * seconds, when access_token stops working.
 */
export type LoggedIn = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

/**
 * What the sign-up form posts. confirm_password is checked by the page and the
 * action, and never sent.
 */
export type NewAppUser = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  password: string;
};

/**
 * What the client posts to trade its refresh token for a new session.
 */
export type RefreshSession = {
  refresh_token: string;
};

/**
 * The signed-in user's own account. has_shop is true for an owner of any shop
 * or a worker with an active chair.
 */
export type Me = {
  first_name: string;
  last_name: string;
  email: string | null;
  has_worker_profile: boolean;
  has_shop: boolean;
};
