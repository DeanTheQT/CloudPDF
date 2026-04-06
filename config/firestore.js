const admin = require("firebase-admin");
const serviceAccount = require("./cloudpdf-ab5ba-firebase-adminsdk-fbsvc-7e179aa6ff.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function saveUser(user) {
  try {
    const docRef = await db.collection("users").add({
      userId: user.id.toString(), 
      username: user.username,
      isAdmin: user.isAdmin || false,
      createdAt: new Date()
    });
    console.log("Firestore user saved! Doc ID:", docRef.id);
    return docRef.id;
  } catch (err) {
    console.error("Error saving user to Firestore:", err);
  }
}

async function saveUpload(upload) {
  try {
    const docRef = await db.collection("uploads").add({
      ...upload,
      createdAt: new Date(),
    });
    console.log("Firestore upload saved! Doc ID:", docRef.id);
    return docRef.id;
  } catch (err) {
    console.error("Error saving upload to Firestore:", err);
  }
}

module.exports = { db, saveUser, saveUpload };