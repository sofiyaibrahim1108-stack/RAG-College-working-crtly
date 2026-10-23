const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role, name: user.name, status: user.status || 'active' },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Check if user is in Admin's Allowlist
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Your email is not registered by the College Admin. Please contact Admin.'
      });
    }

    // 2. Check if account is suspended
    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Account is suspended. Please contact the administrator.'
      });
    }

    // 3. Check if password already set
    if (user.passwordHash) {
      return res.status(409).json({
        success: false,
        message: 'Account is already activated. Please sign in with your password.'
      });
    }

    // 4. Set User's chosen private password
    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(password, salt);
    if (name && !user.name) user.name = name.trim();
    user.status = 'active';
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Account activated successfully! You can now sign in with your password.'
    });
  } catch (err) {
    if (typeof next === 'function') next(err);
    else res.status(500).json({ success: false, message: err.message });
  }
};  

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Account is suspended.' });
    }

    // User allowlist-la irundhum password innum set pannalanna:
    if (!user.passwordHash) {
      return res.status(400).json({
        success: false,
        message: 'Account not activated yet. Please click Register/Sign Up to set your password.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        departmentIds: user.departmentIds || (user.departmentId ? [user.departmentId] : [])
      }
    });
  } catch (err) {
    if (typeof next === 'function') {
      next(err);
    } else {
      res.status(500).json({ success: false, message: err.message });
    }
  }
};

// GET /api/auth/me
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.status(200).json({
      success: true,
      user
    });
  } catch (err) {
    if (typeof next === 'function') {
      next(err);
    } else {
      res.status(500).json({ success: false, message: err.message });
    }
  }
};