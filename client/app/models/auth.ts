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
