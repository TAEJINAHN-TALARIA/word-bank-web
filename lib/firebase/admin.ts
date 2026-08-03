let adminAppCache: any = null;

async function getAdminApp(): Promise<any> {
  if (adminAppCache) return adminAppCache;

  const { cert, getApps, initializeApp } = await import("firebase-admin/app");
  const apps = getApps();
  if (apps.length) {
    adminAppCache = apps[0];
    return adminAppCache;
  }

  const encoded = process.env.FIREBASE_ADMIN_KEY_BASE64;
  if (!encoded) {
    throw new Error("FIREBASE_ADMIN_KEY_BASE64 환경변수가 설정되지 않았습니다");
  }
  const serviceAccount = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
  adminAppCache = initializeApp({ credential: cert(serviceAccount) });
  return adminAppCache;
}

export async function getAdminAuth(): Promise<any> {
  const { getAuth } = await import("firebase-admin/auth");
  return getAuth(await getAdminApp());
}

export async function getAdminFirestore(): Promise<any> {
  const { getFirestore } = await import("firebase-admin/firestore");
  return getFirestore(await getAdminApp());
}
