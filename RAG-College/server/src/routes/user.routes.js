const express = require('express');
const router = express.Router();
const {
  getUsers,
  createUser,
  toggleUserStatus,
  updateUser,
  deleteUser
} = require('../controllers/user.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

// GET /api/users - List all users (Admin only)
router.get('/', protect, authorize('admin'), getUsers);

// POST /api/users - Create user (Admin only)
router.post('/', protect, authorize('admin'), createUser);

// PATCH /api/users/:id/status - Toggle user status (Admin only)
router.patch('/:id/status', protect, authorize('admin'), toggleUserStatus);

// PUT /api/users/:id - Update user (Admin only)
router.put('/:id', protect, authorize('admin'), updateUser);

// DELETE /api/users/:id - Delete user (Admin only)
router.delete('/:id', protect, authorize('admin'), deleteUser);

module.exports = router;