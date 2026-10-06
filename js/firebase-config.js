import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAj036xrs7b4ghREAF6b5Yfbii0393Pei0",
  authDomain: "iiit-spicy-tea.firebaseapp.com",
  projectId: "iiit-spicy-tea",
  storageBucket: "iiit-spicy-tea.firebasestorage.app",
  messagingSenderId: "291653950420",
  appId: "1:291653950420:web:0e65025cb42a580e979441"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
