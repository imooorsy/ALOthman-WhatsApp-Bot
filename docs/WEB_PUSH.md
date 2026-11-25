# Phase 2 Web Push plan

V1 has no background push delivery. Desktop notifications and sound require the dashboard tab to remain open, a user gesture, and browser permission. Urgent reminders are browser timers and stop if the tab closes.

Firebase preparation: the web SDK is installed and `apps/web/components/firebase.ts` provides lazy, browser-only app/messaging initialization. The supplied public Firebase project configuration is saved in the ignored local web environment file. Analytics is not initialized. This preparation does not register for push or send notifications yet.

The supplied public Web Push VAPID key is configured in `apps/web/.env.local` as NEXT_PUBLIC_FIREBASE_VAPID_KEY. Still needed: the local path to the private service-account JSON, to be set only in `apps/api/.env` as GOOGLE_APPLICATION_CREDENTIALS. Keep that JSON outside the repository. The remaining implementation includes the service worker, authenticated per-staff enrollment, current Firebase registration APIs, Firebase Admin queue sender, logout cleanup, deduplication with Socket.IO, and explicit Firebase endpoint allowances in the web CSP. Firebase console setup: https://firebase.google.com/docs/cloud-messaging/web/get-started.

For phase 2, register a same-origin service worker on the web app and generate the VAPID pair in Firebase Cloud Messaging settings. The web app uses its public VAPID key; Firebase Admin uses private server credentials. Add authenticated registration/removal endpoints with Origin checks and a staff-linked table for browser registrations. Treat registrations as credentials and remove invalid or expired registrations based on Firebase Admin responses.

Queue Web Push only for unread eligible notifications after checking user preferences. Push payloads should contain an opaque conversation ID and generic Arabic text; fetch private details after authenticated navigation. Route notificationclick to `/chats/{id}`. Deduplicate by conversation, stop reminders after take/read, and test logged-out, revoked, multi-device and offline behavior. Do not cache authenticated API responses or client transcripts in the service worker.
