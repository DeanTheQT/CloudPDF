// config/db.js
const mongoose = require("mongoose");

/* =========================
   MONGODB CONNECTION
========================= */
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI);
        console.log("[INFO] MongoDB Atlas Connected");
        console.log("[INFO] Database:", conn.connection.name);
    } catch (error) {
        console.error("[ERROR] MongoDB connection error:", error);
        process.exit(1);
    }
};
module.exports = { connectDB };
