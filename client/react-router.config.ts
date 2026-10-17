import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // nginx ends HTTPS and forwards over HTTP, so a form POST's https Origin never
  // matches the request URL and the action is rejected. The domain is also in
  // deploy/setup-ec2.sh.
  allowedActionOrigins: ["book-me-up.com", "www.book-me-up.com"],
} satisfies Config;
