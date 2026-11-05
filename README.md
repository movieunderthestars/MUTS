# Movies Under the Stars

## Admin dashboard

Configure `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the server environment to enable the dashboard at `/admin`. For local development, copy `.env.example` to `.env` and set both values to credentials of your choice. There are no default credentials; the route returns `503` until both values are configured and prompts for HTTP Basic Auth credentials when enabled.

Keep `.env` and its password out of source control. Serve the dashboard over HTTPS in production because HTTP Basic Auth credentials are sent with each request.

The dashboard reads the same waitlist storage configured for the app: MongoDB when `MONGODB_URI` is connected, or `data/waitlist.json` otherwise.

## Survey reminders

People can close the survey after joining and resume it from the same browser using the “Continue your survey” button. Admins can send a reminder from the dashboard to anyone who has not completed the survey. Reminder emails use SMTP; set `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, and `MAIL_FROM`, and set `APP_BASE_URL` to the public site URL. Survey links expire after seven days and are invalidated when the survey is submitted.
