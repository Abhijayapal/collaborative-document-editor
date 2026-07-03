import jwt from "jsonwebtoken";

/**
 * Express middleware — verifies JWT from Authorization: Bearer <token>
 * Sets req.user = { id, username } on success.
 */
export const protect = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authorized — no token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, username, iat, exp }
    next();
  } catch {
    return res.status(401).json({ error: "Token invalid or expired" });
  }
};
