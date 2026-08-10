/* =========================================================
   FIREBASE SETUP
========================================================= */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCVemPUayc_Q-IsbcQxnFRHg8bBLZFSHfA',
  authDomain: 'cell-experiment-tracker.firebaseapp.com',
  projectId: 'cell-experiment-tracker',
  storageBucket: 'cell-experiment-tracker.firebasestorage.app',
  messagingSenderId: '855790481107',
  appId: '1:855790481107:web:a566455d3f13a48a20ae26'
};

let app = null;
let auth = null;
let db = null;
const appId = 'lab-workspace-app';

try {
  if (window.firebase) {
    if (!window.firebase.apps.length) {
      app = window.firebase.initializeApp(FIREBASE_CONFIG);
    } else {
      app = window.firebase.app();
    }
    auth = window.firebase.auth();
    db = window.firebase.firestore();
  }
} catch (e) {
  console.error('Firebase init error. Falling back to local storage.', e);
}

export { app, auth, db, appId };