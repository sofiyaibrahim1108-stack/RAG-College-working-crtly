const User = require('../models/User');
const bcrypt = require('bcryptjs');

// GET /api/users - List all users (Admin only)
exports.getUsers = async (req, res, next) => {
  try {
    const users = await User.find()
      .populate('departmentId', 'name code')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: users.length, data: users });
  } catch (err) {
    if (typeof next === 'function') next(err);
    else res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/users - Admin creates user / teacher / admin
exports.createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, departmentId } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and email are required.' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'User already exists with this email.' });
    }

    let passwordHash = null;
    // Admin password kuduthaa mattum hash aagum, illana empty-aa irukkum (User first time set pannuvaaru)
    if (password && password.trim()) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password.trim(), salt);
    }

    const newUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: role === 'admin' ? 'admin' : 'user',
      departmentId: departmentId || null,
      status: 'active'
    });

    return res.status(201).json({
      success: true,
      message: 'User added to allowlist successfully.',
      data: newUser
    });
  } catch (err) {
    if (typeof next === 'function') next(err);
    else res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/users/:id/status - Toggle active / suspended
exports.toggleUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Use active or suspended.' });
    }

    // Admin thannaye suspend pannikka koodadhu
    if (req.user.id === id) {
      return res.status(400).json({ success: false, message: 'You cannot change your own status.' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.status(200).json({
      success: true,
      message: `User marked as ${status}.`,
      data: updatedUser
    });
  } catch (err) {
    if (typeof next === 'function') next(err);
    else res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/users/:id - Edit user role / department
exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, role, departmentId } = req.body;

    const updateFields = {};
    if (name) updateFields.name = name.trim();
    if (role && ['admin', 'user'].includes(role)) updateFields.role = role;
    if (departmentId !== undefined) updateFields.departmentId = departmentId || null;

    const updatedUser = await User.findByIdAndUpdate(
      id,
      updateFields,
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      data: updatedUser
    });
  } catch (err) {
    if (typeof next === 'function') next(err);
    else res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/users/:id - Delete user
exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.id === id) {
      return res.status(400).json({ success: false, message: 'You cannot delete yourself.' });
    }

    const deleted = await User.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.status(200).json({ success: true, message: 'User deleted permanently.' });
  } catch (err) {
    if (typeof next === 'function') next(err);
    else res.status(500).json({ success: false, message: err.message });
  }
};