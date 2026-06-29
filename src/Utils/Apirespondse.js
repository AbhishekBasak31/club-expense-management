export const sendSuccess = (res, data, message = "Success", status = 200) =>
  res.status(status).json({ success: true, message, data: data ?? null });

export const sendError = (res, message = "Something went wrong", status = 400) =>
  res.status(status).json({ success: false, message });