import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "KEY",
  authDomain: "YOUR_APP.firebaseapp.com",
  projectId: "ID",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
