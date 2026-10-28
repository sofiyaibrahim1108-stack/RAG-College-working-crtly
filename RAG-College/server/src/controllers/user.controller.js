const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Department = require('../models/Department');
const {
  resolveActor,
  toIdString,
  getUserDepartmentIds,
  isAdmin,
  isScopedAdmin,
  canManageUser
} = require('../services/access.service');

function handleError(err, res, next) {
  if (typeof next === 'function') return next(err);
  return res.status(500).json({ success: false, message: err.message });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

// Reads the requested department from either `departmentId` or `departmentIds`.
function readRequestedDepartment(body) {
  const raw =
    body.departmentId !== undefined
      ? body.departmentId
      : Array.isArray(body.departmentIds)
        ? body.departmentIds[0]
        : body.departmentIds;
  return toIdString(raw);
}

// GET /api/users - Super Admin: every user. Department Admin: only staff inside their departments.
exports.getUsers = async (req, res, next) => {
  try {
    const actor = await resolveActor(req);
    if (!isAdmin(actor)) return fail(res, 403, 'Admin privileges required.');

    const query = {};
    const scoped = isScopedAdmin(actor);

    if (scoped) {
      const actorDepts = getUserDepartmentIds(actor);
      query.role = 'user';
      query.$or = [{ departmentIds: { $in: actorDepts } }, { departmentId: { $in: actorDepts } }];
    }

    let users = await User.find(query)
      .populate('departmentId', 'name code')
      .populate('departmentIds', 'name code')
      .sort({ createdAt: -1 });

    if (scoped) {
      users = users.filter((u) => canManageUser(actor, u));
    }

    return res.status(200).json({ success: true, count: users.length, data: users });
  } catch (err) {
    return handleError(err, res, next);
  }
};

// POST /api/users - Create a user. Department Admins can only create staff in their own departments.
exports.createUser = async (req, res, next) => {
  try {
    const actor = await resolveActor(req);
    if (!isAdmin(actor)) return fail(res, 403, 'Admin privileges required.');

    const { name, email, password, role } = req.body;

    if (!name || !email) {
      return fail(res, 400, 'Name and email are required.');
    }

    const newRole = role === 'admin' ? 'admin' : 'user';
    let deptId = readRequestedDepartment(req.body);

    if (isScopedAdmin(actor)) {
      const actorDepts = getUserDepartmentIds(actor);

      if (newRole === 'admin') {
        return fail(res, 403, 'Only a Super Admin can create administrator accounts.');
      }

      if (!deptId) {
        if (actorDepts.length === 1) {
          deptId = actorDepts[0];
        } else {
          return fail(res, 400, 'Select one of your departments for this user.');
        }
      }

      if (!actorDepts.includes(deptId)) {
        return fail(res, 403, 'You can only add users to departments assigned to you.');
      }
    }

    if (deptId) {
      if (!mongoose.isValidObjectId(deptId)) {
        return fail(res, 400, 'Invalid department.');
      }
      const deptExists = await Department.exists({ _id: deptId });
      if (!deptExists) {
        return fail(res, 400, 'Selected department does not exist.');
      }
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return fail(res, 409, 'User already exists with this email.');
    }

    let passwordHash = null;
    // Password is hashed only when provided; otherwise the user sets it on first login.
    if (password && password.trim()) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password.trim(), salt);
    }

    const newUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: newRole,
      departmentId: deptId || null,
      departmentIds: deptId ? [deptId] : [],
      status: 'active'
    });

    return res.status(201).json({
      success: true,
      message: 'User added to allowlist successfully.',
      data: newUser
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};

// PATCH /api/users/:id/status - Toggle active / suspended
exports.toggleUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const actor = await resolveActor(req);
    if (!isAdmin(actor)) return fail(res, 403, 'Admin privileges required.');

    if (!['active', 'suspended'].includes(status)) {
      return fail(res, 400, 'Invalid status. Use active or suspended.');
    }

    if (toIdString(actor._id) === String(id)) {
      return fail(res, 400, 'You cannot change your own status.');
    }

    if (!mongoose.isValidObjectId(id)) return fail(res, 404, 'User not found.');

    const target = await User.findById(id);
    if (!target) return fail(res, 404, 'User not found.');

    if (!canManageUser(actor, target)) {
      return fail(res, 403, 'You do not have permission to manage this user.');
    }

    target.status = status;
    await target.save();

    return res.status(200).json({
      success: true,
      message: `User marked as ${status}.`,
      data: target
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};

// PUT /api/users/:id - Edit user name / role / department
exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, role } = req.body;

    const actor = await resolveActor(req);
    if (!isAdmin(actor)) return fail(res, 403, 'Admin privileges required.');

    if (!mongoose.isValidObjectId(id)) return fail(res, 404, 'User not found.');

    const target = await User.findById(id);
    if (!target) return fail(res, 404, 'User not found.');

    if (!canManageUser(actor, target)) {
      return fail(res, 403, 'You do not have permission to manage this user.');
    }

    const isSelf = toIdString(actor._id) === String(id);
    const departmentProvided = req.body.departmentId !== undefined || req.body.departmentIds !== undefined;
    const requestedDept = departmentProvided ? readRequestedDepartment(req.body) : undefined;

    if (role && ['admin', 'user'].includes(role)) {
      if (isScopedAdmin(actor) && role === 'admin') {
        return fail(res, 403, 'Only a Super Admin can grant administrator access.');
      }
      if (isSelf && role !== target.role) {
        return fail(res, 400, 'You cannot change your own role.');
      }
      target.role = role;
    }

    if (name) target.name = name.trim();

    if (departmentProvided) {
      if (isScopedAdmin(actor)) {
        const actorDepts = getUserDepartmentIds(actor);
        if (!requestedDept || !actorDepts.includes(requestedDept)) {
          return fail(res, 403, 'You can only assign users to departments assigned to you.');
        }
      }

      if (requestedDept) {
        if (!mongoose.isValidObjectId(requestedDept)) return fail(res, 400, 'Invalid department.');
        const deptExists = await Department.exists({ _id: requestedDept });
        if (!deptExists) return fail(res, 400, 'Selected department does not exist.');
      }

      target.departmentId = requestedDept || null;
      target.departmentIds = requestedDept ? [requestedDept] : [];
    }

    await target.save();

    return res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      data: target
    });
  } catch (err) {
    return handleError(err, res, next);
  }
};

// DELETE /api/users/:id - Delete user
exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const actor = await resolveActor(req);
    if (!isAdmin(actor)) return fail(res, 403, 'Admin privileges required.');

    if (toIdString(actor._id) === String(id)) {
      return fail(res, 400, 'You cannot delete yourself.');
    }

    if (!mongoose.isValidObjectId(id)) return fail(res, 404, 'User not found.');

    const target = await User.findById(id);
    if (!target) return fail(res, 404, 'User not found.');

    if (!canManageUser(actor, target)) {
      return fail(res, 403, 'You do not have permission to delete this user.');
    }

    await User.findByIdAndDelete(id);

    return res.status(200).json({ success: true, message: 'User deleted permanently.' });
  } catch (err) {
    return handleError(err, res, next);
  }
};