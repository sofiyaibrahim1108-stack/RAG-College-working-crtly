const jwt = require('jsonwebtoken');

// Token verification
exports.protect = (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.'
    });
  }
};

// Role-based authorization (e.g., authorize('admin'))
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. You do not have access to this action.'
      });
    }
    next();
  };
};

// Aliases for compatibility
exports.verifyToken = exports.protect;
exports.requireAdmin = exports.authorize('admin');
exports.requireStaff = exports.authorize('admin', 'staff', 'user');