const admin = require('firebase-admin');

let firebaseApp = null;

function initFirebase() {
  if (firebaseApp) return firebaseApp;

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT not set - push notifications disabled');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase Admin initialized - push notifications enabled');
    return firebaseApp;
  } catch (err) {
    console.error('❌ Firebase Admin init failed:', err.message);
    return null;
  }
}

// Sends a push notification to a single FCM token. Fails silently (logs only) so a bad
// or expired token never breaks the calling request (e.g. joining a tournament).
async function sendPushNotification(token, title, body, data = {}) {
  if (!token) return;
  const app = initFirebase();
  if (!app) return;

  const stringData = {};
  for (const key in data) {
    stringData[key] = String(data[key]);
  }

  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      data: stringData,
    });
  } catch (err) {
    console.error('Push notification failed:', err.message);
  }
}

// Sends the same notification to multiple tokens at once (e.g. all players in a tournament)
async function sendPushToMany(tokens, title, body, data = {}) {
  const validTokens = (tokens || []).filter(Boolean);
  if (validTokens.length === 0) {
    console.log('sendPushToMany: no valid tokens to send to');
    return;
  }
  const app = initFirebase();
  if (!app) {
    console.log('sendPushToMany: firebase app not initialized');
    return;
  }

  // FCM data payload values must all be strings - stringify anything that isn't
  const stringData = {};
  for (const key in data) {
    stringData[key] = String(data[key]);
  }

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens: validTokens,
      notification: { title, body },
      data: stringData,
    });
    console.log(`sendPushToMany: ${response.successCount} succeeded, ${response.failureCount} failed`);
    response.responses.forEach((r, i) => {
      if (!r.success) {
        console.log(`  Token ${i} failed: ${r.error?.code} - ${r.error?.message}`);
      }
    });
  } catch (err) {
    console.error('Bulk push notification failed:', err.message);
  }
}

module.exports = { initFirebase, sendPushNotification, sendPushToMany };
