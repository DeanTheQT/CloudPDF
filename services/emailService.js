function ensureMailerConfig() {
  if (!process.env.BREVO_API_KEY) {
    throw new Error("Missing BREVO_API_KEY in environment");
  }

  if (!process.env.EMAIL_NAME) {
    throw new Error("Missing EMAIL_NAME in environment");
  }
}

async function sendEmail({ to, subject, textContent, htmlContent }) {
  ensureMailerConfig();

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        email: process.env.EMAIL_NAME,
        name: "CloudPDF"
      },
      to: [
        {
          email: to
        }
      ],
      subject,
      textContent,
      htmlContent
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Brevo email failed: ${response.status} ${errorBody}`);
  }
}

async function sendOtpEmail({ email, otp, username }) {
  await sendEmail({
    to: email,
    subject: "Your CloudPDF OTP Code",
    textContent: `Hello ${username}, your CloudPDF OTP code is ${otp}. It expires in 10 minutes.`,
    htmlContent: `<p>Hello ${username},</p><p>Your CloudPDF OTP code is:</p><h2 style="letter-spacing:4px;">${otp}</h2><p>This code expires in 10 minutes.</p>`
  });
}

async function sendPasswordResetEmail({ email, otp }) {
  await sendEmail({
    to: email,
    subject: "Your CloudPDF Password Reset Code",
    textContent: `Your CloudPDF password reset code is ${otp}. It expires in 10 minutes.`,
    htmlContent: `<p>Your CloudPDF password reset code is:</p><h2 style="letter-spacing:4px;">${otp}</h2><p>This code expires in 10 minutes.</p>`
  });
}

module.exports = { sendOtpEmail, sendPasswordResetEmail };
