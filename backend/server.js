
require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const connectDB = require("./config/db");
const roomRoutes = require("./routes/roomRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const availabilityRoutes = require("./routes/availabilityRoutes");
const adminRoutes = require("./routes/adminRoutes");
const { ensureOwnerFromEnv } = require("./utils/adminAuth");

const app = express();

// The website files live next to the backend folder. Serving them from here
// means the site and the booking API share one address (no CORS needed).
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

// Render and most hosts sit behind one proxy; this gives the real visitor
// address to the admin sign-in lock-out.
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:"],
      frameSrc: ["https://www.google.com"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
}));


app.use(cors({
    origin: [
        "http://localhost:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "https://zebra-domus-inn-website.onrender.com",
        "https://zebradormusinn.com",
        "https://www.zebradormusinn.com"
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));


app.use(express.json({ limit: "20kb" }));


app.use("/api/rooms", roomRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api", (req, res) => {
  res.json({
    message: "Welcome to Zebra Dormus Inn API",
  });
});

app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Not found.",
  });
});

// The website itself: index.html, book.html, admin.html, images...
app.use(express.static(FRONTEND_DIR, { extensions: ["html"] }));

// Bad JSON or other request errors: answer in JSON, never with a stack trace.
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const status = error.status || error.statusCode || 500;

  if (status >= 500) {
    console.error("Request failed:", error.message);
  }

  return res.status(status).json({
    success: false,
    message: status >= 500 ? "Something went wrong. Please try again." : "The request could not be read.",
  });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    await ensureOwnerFromEnv();

    app.listen(PORT, () => {
      console.log(`Zebra Dormus Inn server running on port ${PORT}`);
      console.log(`Website:   http://localhost:${PORT}`);
      console.log(`Admin:     http://localhost:${PORT}/admin.html`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
