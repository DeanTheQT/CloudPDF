# CloudPDF

CloudPDF is an Express-based web application for thesis PDF summarization, user account management, admin moderation, and message handling.

## Features

- User registration, login, session handling, and profile management
- Thesis PDF upload and AI-powered summarization
- Thesis validation before summaries are queued or stored
- Summary history for users
- Admin dashboard for users, messages, analytics, archived records, and admin activity logs
- Background upload queue processing

## Tech Stack

- Node.js
- Express
- MongoDB with Mongoose
- `express-session` with Mongo session storage
- Gemini via `@google/generative-ai`
- `pdf-parse`

## Project Structure

```text
controllers/   Request handlers
routes/        Express route definitions
services/      AI, caching, logging, email, and queue services
models/        Mongoose models
middleware/    CSRF, admin, and rate limit middleware
public/        Static frontend files
uploads/       Uploaded PDF files
config/        Database connection config
server.js      App entry point
```

## Requirements

- Node.js 18+
- MongoDB connection string
- Gemini API key

## Environment Variables

Create a `.env` file in the project root with values like:

```env
PORT=5000
SESSION_SECRET=your_session_secret
MONGODB_URI=your_mongodb_connection_string
GEMINI_API=your_gemini_api_key
EMAIL_NAME=your_sender_email
BREVO_API_KEY=your_brevo_api_key
```

## Installation

```bash
npm install
```

## Run

```bash
npm start
node server.js
```

The app starts from `server.js` and serves the frontend from `public/`.

## Main Routes

- `/` -> home page
- `/auth/*` -> authentication and account routes
- `/upload`, `/uploads`, `/upload/status/:id` -> upload and summary routes
- `/messages/*` -> user/admin messaging routes
- `/admin/*` -> admin dashboard routes

## Notes

- Uploaded PDFs are validated as thesis-like documents before they are queued and stored as summaries.
- Upload processing runs through a background queue started when the server boots.
- CSRF protection is enabled for mutating requests.
- There is currently no real automated test suite configured in `package.json`.

## Render Link

https://cloudpdf-o2q9.onrender.com/ 
