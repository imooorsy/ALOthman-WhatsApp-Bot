"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import type { Messaging } from "firebase/messaging";

// Firebase web configuration is public. Admin credentials never belong here.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function getFirebaseApp(): FirebaseApp | null {
  if (typeof window === "undefined") return null;
  if (
    !firebaseConfig.apiKey ||
    !firebaseConfig.projectId ||
    !firebaseConfig.messagingSenderId ||
    !firebaseConfig.appId
  )
    return null;
  return (
    getApps().find((app) => app.name === "osman-dashboard") ??
    initializeApp(firebaseConfig, "osman-dashboard")
  );
}

// Lazy loading keeps browser-only messaging out of server rendering.
// Registration is handled by push-client.ts after permission is granted.
export async function getFirebaseMessaging(): Promise<Messaging | null> {
  const app = getFirebaseApp();
  if (!app) return null;
  const { getMessaging, isSupported } = await import("firebase/messaging");
  return (await isSupported()) ? getMessaging(app) : null;
}
