// Global error handler — catches everything thrown in routes/controllers
export const errorHandler = (err, req, res, next) => {
  console.error("❌", err.message);
  const status = err.status || err.statusCode || 500;
  const message =
    process.env.NODE_ENV === "production" && status === 500
      ? "Internal server error"
      : err.message || "Something went wrong";
  res.status(status).json({ success: false, message });
};

// 404 handler — for routes that don't exist
export const notFound = (req, res) =>
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });