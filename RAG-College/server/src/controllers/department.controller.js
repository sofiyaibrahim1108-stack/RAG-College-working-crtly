const mongoose = require('mongoose');
const Department = require('../models/Department');
const Document = require('../models/Document');
const {
  resolveActor,
  getUserDepartmentIds,
  isScopedAdmin,
  isSuperAdmin
} = require('../services/access.service');

const defaultDepartments = [
  {
    name: 'Computer Science & Engineering',
    code: 'CSE',
    description: 'Core CS algorithms, systems, DBMS, networking',
    aliases: ['computer science', 'cs']
  },
  {
    name: 'Artificial Intelligence & Data Science',
    code: 'AI & DS',
    description: 'Machine learning, deep learning, NLP, computer vision',
    aliases: ['artificial intelligence', 'machine learning', 'data science', 'ai/ds', 'ai & ds', 'ai ds', 'ai']
  },
  {
    name: 'Master of Computer Applications',
    code: 'MCA',
    description: 'Software engineering, web apps, enterprise systems',
    aliases: ['computer applications']
  },
  {
    name: 'Information Technology',
    code: 'IT',
    description: 'Cloud computing, information security, distributed systems',
    aliases: ['information technology']
  }
];

// Creating, editing, seeding and deleting departments is a Super Admin job.
// Returns true when the request was blocked (response already sent).
async function blockUnlessSuperAdmin(req, res) {
  const actor = await resolveActor(req);
  if (!isSuperAdmin(actor)) {
    res.status(403).json({
      success: false,
      message: 'Only a Super Admin can manage departments.'
    });
    return true;
  }
  return false;
}

// GET /api/departments - Super Admin / staff: all departments. Department Admin: only their own.
exports.getDepartments = async (req, res) => {
  try {
    const actor = await resolveActor(req);
    const filter = {};

    if (isScopedAdmin(actor)) {
      const ownIds = getUserDepartmentIds(actor).filter((id) => mongoose.isValidObjectId(id));
      filter._id = { $in: ownIds };
    }

    const departments = await Department.find(filter).sort({ name: 1 });

    // Update live document counts efficiently
    const departmentsWithCounts = await Promise.all(
      departments.map(async (dept) => {
        const count = await Document.countDocuments({ departmentIds: dept._id });
        return {
          _id: dept._id,
          name: dept.name,
          code: dept.code,
          description: dept.description,
          aliases: dept.aliases || [],
          documentCount: count,
          createdAt: dept.createdAt
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: departmentsWithCounts.length,
      data: departmentsWithCounts
    });
  } catch (error) {
    console.error('Error fetching departments:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/departments - Create a department
exports.createDepartment = async (req, res) => {
  try {
    if (await blockUnlessSuperAdmin(req, res)) return;

    const { name, code, description, aliases } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Department name and code are required'
      });
    }

    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();

    const existing = await Department.findOne({
      $or: [{ name: cleanName }, { code: cleanCode }]
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Department with name "${cleanName}" or code "${cleanCode}" already exists`
      });
    }

    const parsedAliases = Array.isArray(aliases)
      ? aliases.map((a) => String(a).trim()).filter(Boolean)
      : (typeof aliases === 'string' ? aliases.split(',').map((a) => a.trim()).filter(Boolean) : []);

    const dept = await Department.create({
      name: cleanName,
      code: cleanCode,
      description: description ? description.trim() : '',
      aliases: parsedAliases
    });

    return res.status(201).json({
      success: true,
      message: 'Department created successfully',
      data: dept
    });
  } catch (error) {
    console.error('Error creating department:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/departments/seed - Seed default college departments
exports.seedDepartments = async (req, res) => {
  try {
    if (await blockUnlessSuperAdmin(req, res)) return;

    const seeded = [];
    for (const item of defaultDepartments) {
      const exists = await Department.findOne({ code: item.code });
      if (!exists) {
        const created = await Department.create(item);
        seeded.push(created);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Seeded ${seeded.length} departments`,
      seeded
    });
  } catch (error) {
    console.error('Error seeding departments:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/departments/:id - Update an existing department
exports.updateDepartment = async (req, res) => {
  try {
    if (await blockUnlessSuperAdmin(req, res)) return;

    const { id } = req.params;
    const { name, code, description, aliases } = req.body;

    const dept = await Department.findById(id);
    if (!dept) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Department name and code are required'
      });
    }

    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();

    // Check if another department has the same name or code
    const existing = await Department.findOne({
      _id: { $ne: id },
      $or: [{ name: cleanName }, { code: cleanCode }]
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Department with name "${cleanName}" or code "${cleanCode}" already exists`
      });
    }

    dept.name = cleanName;
    dept.code = cleanCode;
    dept.description = description ? description.trim() : '';
    if (aliases !== undefined) {
      dept.aliases = Array.isArray(aliases)
        ? aliases.map((a) => String(a).trim()).filter(Boolean)
        : (typeof aliases === 'string' ? aliases.split(',').map((a) => a.trim()).filter(Boolean) : []);
    }

    await dept.save();

    return res.status(200).json({
      success: true,
      message: 'Department updated successfully',
      data: dept
    });
  } catch (error) {
    console.error('Error updating department:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/departments/:id
exports.deleteDepartment = async (req, res) => {
  try {
    if (await blockUnlessSuperAdmin(req, res)) return;

    const { id } = req.params;
    const dept = await Department.findById(id);
    if (!dept) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    // Check if any documents belong to this department
    const attachedDocs = await Document.countDocuments({ departmentIds: id });
    if (attachedDocs > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete department: ${attachedDocs} document(s) are currently assigned to it`
      });
    }

    await Department.findByIdAndDelete(id);
    return res.status(200).json({ success: true, message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Error deleting department:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};