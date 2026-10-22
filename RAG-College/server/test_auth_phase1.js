/**
 * Non-destructive automated test suite for Phase 1 Authentication & Role Verification
 * Validates User model, Auth controller (register, login, getMe), and Auth middlewares.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { MONGO_URI, JWT_SECRET } = require('./src/config/env');
const User = require('./src/models/User');
const { verifyToken, requireAdmin, requireStaff } = require('./src/middlewares/auth.middleware');
const authController = require('./src/controllers/auth.controller');

// Mock Express req, res, next helpers
function createMockReqRes({ body = {}, headers = {}, params = {}, user = null } = {}) {
  const req = {
    body,
    headers,
    params,
    user
  };

  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(name, val) {
      this.headers[name] = val;
    }
  };

  return { req, res };
}

async function runAuthTests() {
  console.log('\n======================================================');
  console.log(' Starting Phase 1 Authentication & Role Verification Tests');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, errorDetails = '') {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName} ${errorDetails ? '- ' + errorDetails : ''}`);
      failed++;
    }
  }

  // Connect to DB for integration verification
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB: ${mongoose.connection.name}`);

  const testSuffix = `${Date.now()}`;
  const testStaffEmail = `test.staff.${testSuffix}@college.edu`;
  const testAdminEmail = `test.admin.${testSuffix}@college.edu`;
  const testSuspendedEmail = `test.suspended.${testSuffix}@college.edu`;
  const testPassword = 'StrongPassword123!';

  const createdUserIds = [];

  try {
    // ----------------------------------------------------
    // TEST 1: Public Registration enforces 'staff' role
    // ----------------------------------------------------
    console.log('\n--- 1. Testing Registration Role Safety ---');
    {
      const { req, res } = createMockReqRes({
        body: {
          name: 'Attacker Attempting Admin',
          email: testStaffEmail,
          password: testPassword,
          role: 'admin', // Malicious attempt to escalate role
          status: 'active'
        }
      });

      await authController.register(req, res);

      assert(res.statusCode === 201, 'Registration returns HTTP 201 Created');
      assert(res.body && res.body.success === true, 'Registration body success is true');
      assert(res.body && res.body.token, 'Registration returns JWT token');
      assert(res.body && res.body.user && res.body.user.role === 'staff', 'Privilege Escalation Blocked: Role is forced to "staff" despite client sending "admin"');
      assert(res.body && !res.body.user.passwordHash, 'Response excludes passwordHash');

      if (res.body?.user?.id) createdUserIds.push(res.body.user.id);
    }

    // ----------------------------------------------------
    // TEST 2: Duplicate Registration Blocked (409)
    // ----------------------------------------------------
    console.log('\n--- 2. Testing Duplicate Email Handling ---');
    {
      const { req, res } = createMockReqRes({
        body: {
          name: 'Duplicate Staff',
          email: testStaffEmail,
          password: testPassword
        }
      });

      await authController.register(req, res);
      assert(res.statusCode === 409, 'Duplicate registration returns HTTP 409 Conflict');
      assert(res.body && res.body.success === false, 'Duplicate registration returns success: false');
    }

    // ----------------------------------------------------
    // TEST 3: Validation: Short Password & Invalid Email
    // ----------------------------------------------------
    console.log('\n--- 3. Testing Input Validations ---');
    {
      const { req: r1, res: s1 } = createMockReqRes({
        body: { name: 'Short Pwd', email: 'valid@college.edu', password: '123' }
      });
      await authController.register(r1, s1);
      assert(s1.statusCode === 400, 'Password shorter than 8 chars rejected with HTTP 400');

      const { req: r2, res: s2 } = createMockReqRes({
        body: { name: 'Bad Email', email: 'invalid-email-string', password: testPassword }
      });
      await authController.register(r2, s2);
      assert(s2.statusCode === 400, 'Invalid email format rejected with HTTP 400');
    }

    // ----------------------------------------------------
    // TEST 4: Successful Login
    // ----------------------------------------------------
    console.log('\n--- 4. Testing Login Workflow ---');
    let staffToken = '';
    {
      const { req, res } = createMockReqRes({
        body: {
          email: testStaffEmail.toUpperCase(), // Test case-insensitive email normalization
          password: testPassword
        }
      });

      await authController.login(req, res);
      assert(res.statusCode === 200, 'Login with valid credentials returns HTTP 200');
      assert(res.body && res.body.token, 'Login returns signed JWT token');
      assert(res.body && !res.body.user?.passwordHash, 'Login response never returns passwordHash');
      assert(res.body && res.body.user?.email === testStaffEmail, 'Email is properly normalized');

      staffToken = res.body?.token;
    }

    // ----------------------------------------------------
    // TEST 5: Login with Wrong Password (401)
    // ----------------------------------------------------
    console.log('\n--- 5. Testing Login Failure Handling ---');
    {
      const { req, res } = createMockReqRes({
        body: {
          email: testStaffEmail,
          password: 'IncorrectPassword999'
        }
      });

      await authController.login(req, res);
      assert(res.statusCode === 401, 'Invalid password returns HTTP 401');
      assert(res.body && res.body.message === 'Invalid email or password', 'Generic error message used to prevent account enumeration');
    }

    // ----------------------------------------------------
    // TEST 6: Suspended Account Denied
    // ----------------------------------------------------
    console.log('\n--- 6. Testing Suspended Account Restrictions ---');
    let suspendedToken = '';
    {
      const pwdHash = await bcrypt.hash(testPassword, 10);
      const suspendedUser = await User.create({
        name: 'Suspended Staff',
        email: testSuspendedEmail,
        passwordHash: pwdHash,
        role: 'staff',
        status: 'suspended'
      });
      createdUserIds.push(suspendedUser._id.toString());

      // Attempt login
      const { req: loginReq, res: loginRes } = createMockReqRes({
        body: { email: testSuspendedEmail, password: testPassword }
      });
      await authController.login(loginReq, loginRes);
      assert(loginRes.statusCode === 403, 'Suspended account login blocked with HTTP 403');

      // Forge/sign token as if acquired before suspension
      suspendedToken = jwt.sign(
        { id: suspendedUser._id.toString(), role: 'staff', departmentId: null },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      // Verify token middleware also rejects suspended accounts
      const { req: midReq, res: midRes } = createMockReqRes({
        headers: { authorization: `Bearer ${suspendedToken}` }
      });
      let nextCalled = false;
      await verifyToken(midReq, midRes, () => { nextCalled = true; });

      assert(midRes.statusCode === 403, 'verifyToken rejects suspended account even with valid unexpired JWT');
      assert(!nextCalled, 'next() is not called for suspended account');
    }

    // ----------------------------------------------------
    // TEST 7: verifyToken Middleware Behavior
    // ----------------------------------------------------
    console.log('\n--- 7. Testing verifyToken Middleware ---');
    {
      // Missing header
      const { req: r1, res: s1 } = createMockReqRes({});
      await verifyToken(r1, s1, () => {});
      assert(s1.statusCode === 401, 'Missing Authorization header returns 401');

      // Malformed header
      const { req: r2, res: s2 } = createMockReqRes({ headers: { authorization: 'Basic 12345' } });
      await verifyToken(r2, s2, () => {});
      assert(s2.statusCode === 401, 'Non-Bearer Authorization returns 401');

      // Invalid token signature
      const { req: r3, res: s3 } = createMockReqRes({ headers: { authorization: 'Bearer invalid.token.signature' } });
      await verifyToken(r3, s3, () => {});
      assert(s3.statusCode === 401, 'Corrupted token signature returns 401');

      // Valid staff token
      const { req: r4, res: s4 } = createMockReqRes({ headers: { authorization: `Bearer ${staffToken}` } });
      let next4Called = false;
      await verifyToken(r4, s4, () => { next4Called = true; });
      assert(next4Called, 'Valid token passes verifyToken to next()');
      assert(r4.user && r4.user.role === 'staff', 'req.user is decorated with validated server identity');
      assert(r4.user && r4.user.status === 'active', 'req.user has status active');
    }

    // ----------------------------------------------------
    // TEST 8: requireAdmin & requireStaff RBAC Enforcement
    // ----------------------------------------------------
    console.log('\n--- 8. Testing Role-Based Authorization Guards ---');
    {
      // Create a valid Admin user
      const adminPwdHash = await bcrypt.hash(testPassword, 10);
      const adminUser = await User.create({
        name: 'Test Administrator',
        email: testAdminEmail,
        passwordHash: adminPwdHash,
        role: 'admin',
        status: 'active'
      });
      createdUserIds.push(adminUser._id.toString());

      const adminToken = jwt.sign(
        { id: adminUser._id.toString(), role: 'admin', departmentId: null },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      // Staff accessing Admin guard -> 403 Forbidden
      const { req: rStaff, res: sStaff } = createMockReqRes({
        user: { id: createdUserIds[0], role: 'staff', status: 'active' }
      });
      let adminNextFromStaff = false;
      requireAdmin(rStaff, sStaff, () => { adminNextFromStaff = true; });
      assert(sStaff.statusCode === 403, 'requireAdmin returns HTTP 403 for Staff user');
      assert(!adminNextFromStaff, 'next() not called for Staff on Admin route');

      // Admin accessing Admin guard -> passes
      const { req: rAdmin, res: sAdmin } = createMockReqRes({
        user: { id: adminUser._id.toString(), role: 'admin', status: 'active' }
      });
      let adminNextFromAdmin = false;
      requireAdmin(rAdmin, sAdmin, () => { adminNextFromAdmin = true; });
      assert(adminNextFromAdmin, 'requireAdmin allows Admin user');

      // Staff accessing Staff guard -> passes
      let staffNextFromStaff = false;
      requireStaff(rStaff, sStaff, () => { staffNextFromStaff = true; });
      assert(staffNextFromStaff, 'requireStaff allows Staff user');

      // Admin accessing Staff guard -> passes (admin is not blocked from staff features)
      let staffNextFromAdmin = false;
      requireStaff(rAdmin, sAdmin, () => { staffNextFromAdmin = true; });
      assert(staffNextFromAdmin, 'requireStaff allows Admin user');
    }

    // ----------------------------------------------------
    // TEST 9: getMe Protected Endpoint
    // ----------------------------------------------------
    console.log('\n--- 9. Testing /api/auth/me Endpoint ---');
    {
      const { req, res } = createMockReqRes({
        user: { id: createdUserIds[0] }
      });

      await authController.getMe(req, res);
      assert(res.statusCode === 200, 'getMe returns HTTP 200 for authenticated user');
      assert(res.body && res.body.user && res.body.user.email === testStaffEmail, 'getMe returns accurate user profile');
      assert(!res.body.user.passwordHash, 'getMe never exposes passwordHash');
    }

  } finally {
    // Clean up temporary test data cleanly
    console.log('\n--- Cleaning up temporary test records ---');
    if (createdUserIds.length > 0) {
      const deleteResult = await User.deleteMany({ _id: { $in: createdUserIds } });
      console.log(`Cleaned up ${deleteResult.deletedCount} test user records.`);
    }
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }

  console.log('\n======================================================');
  console.log(` Final Test Results: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
