const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { JWT_SECRET } = require('../config/env');
const { logAction } = require('../services/audit.service');

// Helper to sign JWT
const signToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      name: user.name,
      status: user.status
    },
    JWT_SECRET || 'fallback_secret',
    { expiresIn: '7d' }
  );
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact admin.'
      });
    }

    if (!user.passwordHash) {
      return res.status(400).json({
        success: false,
        message: 'Account not activated. Please register/activate your password first.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const token = signToken(user);

    // Record LOGIN Audit Log
    logAction({
      req: { ...req, user },
      action: 'LOGIN',
      resourceType: 'Auth',
      resourceId: user._id,
      details: {
        email: user.email,
        role: user.role,
        name: user.name
      }
    });

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        departmentIds: user.departmentIds,
        status: user.status
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during login'
    });
  }
};

// POST /api/auth/register (Allowlist password activation)
exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (!existingUser) {
      return res.status(403).json({
        success: false,
        message: 'Email is not pre-registered by administrator. Contact college admin.'
      });
    }

    if (existingUser.passwordHash) {
      return res.status(400).json({
        success: false,
        message: 'Account is already activated. Please login.'
      });
    }

    const salt = await bcrypt.genSalt(10);
    existingUser.passwordHash = await bcrypt.hash(password, salt);
    if (name) existingUser.name = name;
    existingUser.status = 'active';

    await existingUser.save();

    // Record USER_STATUS_CHANGE / Activation Log
    logAction({
      req: { ...req, user: existingUser },
      action: 'USER_STATUS_CHANGE',
      resourceType: 'User',
      resourceId: existingUser._id,
      details: {
        email: existingUser.email,
        status: 'active',
        note: 'Account password activated by user'
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Account activated successfully. You can now login.'
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error during activation'
    });
  }
};

// GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id || req.user._id).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.status(200).json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/auth/profile
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { name, currentPassword, newPassword } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Name update
    if (name && name.trim()) {
      user.name = name.trim();
    }

    // Password change logic
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is required to set a new password'
        });
      }

      if (!user.passwordHash) {
        return res.status(400).json({
          success: false,
          message: 'No existing password found to verify'
        });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: 'Current password does not match'
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 6 characters long'
        });
      }

      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(newPassword, salt);
    }

    // Email is strictly locked and cannot be changed
    await user.save();

    // Log the update action
    logAction({
      req: { ...req, user },
      action: 'USER_UPDATE',
      resourceType: 'User',
      resourceId: user._id,
      details: {
        email: user.email,
        name: user.name,
        passwordChanged: Boolean(newPassword)
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        departmentIds: user.departmentIds,
        status: user.status
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while updating profile'
    });
  }
};