import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function getAdminApp(): App {
  const apps = getApps();
  if (apps.length) return apps[0];

  const encoded = process.env.FIREBASE_ADMIN_KEY_BASE64;
  if (!encoded) {
    throw new Error("FIREBASE_ADMIN_KEY_BASE64 환경변수가 설정되지 않았습니다");
  }
  const serviceAccount = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
  return initializeApp({ credential: cert(serviceAccount) });
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp());
}
