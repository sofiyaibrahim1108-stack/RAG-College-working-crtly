const express = require('express');
const router = express.Router();
const {
  getDepartments,
  createDepartment,
  updateDepartment,
  seedDepartments,
  deleteDepartment
} = require('../controllers/department.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

// Listing now requires login so each admin only receives the departments they may see.
router.get('/', protect, getDepartments);
router.post('/', protect, authorize('admin'), createDepartment);
router.put('/:id', protect, authorize('admin'), updateDepartment);
router.post('/seed', protect, authorize('admin'), seedDepartments);
router.delete('/:id', protect, authorize('admin'), deleteDepartment);

module.exports = router;