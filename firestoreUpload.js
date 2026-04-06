const admin = require("firebase-admin");
const serviceAccount = require("./cloudpdf-ab5ba-firebase-adminsdk-fbsvc-7e179aa6ff.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

/**
 * Save new user info into Firestore
 * @param {Object} user - { id, username }
 */
async function saveUserToFirestore(user) {
  try {
    const docRef = await db.collection("users").add({
      userId: user.id,
      username: user.username,
      createdAt: new Date(),
    });

    console.log("Firestore user saved! Document ID:", docRef.id);
  } catch (err) {
    console.error("Firestore write failed:", err);
  }
}

module.exports = saveUserToFirestore;