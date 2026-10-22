require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function seedAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected for seeding admin...');

    const email = 'admin@college.edu';
    const existing = await User.findOne({ email });
    if (existing) {
      console.log('Admin already exists.');
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('Admin@123', salt);

    await User.create({
      name: 'System Admin',
      email,
      passwordHash,
      role: 'admin',
      departmentIds: []
    });

    console.log('Admin user created successfully! (admin@college.edu / Admin@123)');
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seedAdmin();