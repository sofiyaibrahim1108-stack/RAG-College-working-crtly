const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
    },
    passwordHash: {
      type: String,
      // required: [true, 'Password hash is required']
      default: null
    },
    role: {
      type: String,
      enum: {
        values: ['admin', 'user'],
        message: '{VALUE} is not a valid role'
      },
      default: 'user',
      lowercase: true,
      trim: true
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null
    },
    departmentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department'
      }
    ],
    status: {
      type: String,
      enum: {
        values: ['active', 'suspended'],
        message: '{VALUE} is not a valid status'
      },
      default: 'active'
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      }
    },
    toObject: {
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Indexes
userSchema.index({ role: 1, departmentId: 1 });

module.exports = mongoose.model('User', userSchema);
