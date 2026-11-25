# Phase 2 Web Push plan

V1 has no background push delivery. Desktop notifications and sound require the dashboard tab to remain open, a user gesture, and browser permission. Urgent reminders are browser timers and stop if the tab closes.

For phase 2, register a same-origin service worker on the web app, generate VAPID keys outside source control, and store the private key only in API environment configuration. Add authenticated subscription registration/removal endpoints with Origin checks, and a staff-linked table for endpoint and encryption keys. Treat those keys as credentials and remove expired subscriptions on 404/410 push responses.

Queue Web Push only for unread eligible notifications after checking user preferences. Push payloads should contain an opaque conversation ID and generic Arabic text; fetch private details after authenticated navigation. Route notificationclick to `/chats/{id}`. Deduplicate by conversation, stop reminders after take/read, and test logged-out, revoked, multi-device and offline behavior. Do not cache authenticated API responses or client transcripts in the service worker.
