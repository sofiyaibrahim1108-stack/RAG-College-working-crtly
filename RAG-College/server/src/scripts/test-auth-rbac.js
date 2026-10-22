require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const http = require('http');
const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');

async function runTests() {
  console.log('--- Starting Authentication & RBAC Verification Tests ---');

  if (!mongoose.connection.readyState) {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[OK] MongoDB connected');
  }

  // Start ephemeral server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[OK] Test server listening on ${baseUrl}`);

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Clean up any previous test user
    await User.deleteOne({ email: 'test_student_rbac@college.edu' });

    // 2. Test Admin Login
    console.log('\n1. Testing Admin Login');
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@college.edu', password: 'Admin@123' })
    });
    const adminLoginData = await adminLoginRes.json();
    assert(adminLoginRes.status === 200, `Admin login returns 200 (got ${adminLoginRes.status})`);
    assert(adminLoginData.success === true, 'Admin login response has success: true');
    assert(Boolean(adminLoginData.token), 'Admin login returns a JWT token');
    assert(adminLoginData.user?.role === 'admin', `Admin user has role "admin" (got "${adminLoginData.user?.role}")`);
    const adminToken = adminLoginData.token;

    // 3. Test Invalid Credentials
    console.log('\n2. Testing Invalid Credentials');
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@college.edu', password: 'WrongPassword' })
    });
    assert(badLoginRes.status === 401, `Invalid password returns 401 Unauthorized (got ${badLoginRes.status})`);

    // 4. Test User Registration
    console.log('\n3. Testing User Registration');
    const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'RBAC Test Student',
        email: 'test_student_rbac@college.edu',
        password: 'Password123',
        role: 'user'
      })
    });
    const registerData = await registerRes.json();
    assert(registerRes.status === 201, `User registration returns 201 Created (got ${registerRes.status})`);
    assert(registerData.success === true, 'Registration has success: true');
    assert(registerData.user?.role === 'user', `Registered user role is "user" (got "${registerData.user?.role}")`);
    assert(Boolean(registerData.token), 'Registration returns a valid JWT token');
    const userToken = registerData.token;

    // 5. Test Privilege Escalation Prevention on Register
    console.log('\n4. Testing Privilege Escalation Prevention');
    await User.deleteOne({ email: 'test_hacker@college.edu' });
    const hackerRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Hacker Attempt',
        email: 'test_hacker@college.edu',
        password: 'Password123',
        role: 'admin' // Attempting to escalate to admin
      })
    });
    const hackerData = await hackerRes.json();
    assert(hackerData.user?.role === 'user', `Public registration with role "admin" is forced to "user" (got "${hackerData.user?.role}")`);
    await User.deleteOne({ email: 'test_hacker@college.edu' });

    // 6. Test /api/auth/me
    console.log('\n5. Testing /api/auth/me');
    // 6a. Unauthenticated
    const meNoTokenRes = await fetch(`${baseUrl}/api/auth/me`);
    assert(meNoTokenRes.status === 401, `Unauthenticated /api/auth/me returns 401 (got ${meNoTokenRes.status})`);

    // 6b. Invalid token
    const meBadTokenRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer this.is.an.invalid.token' }
    });
    assert(meBadTokenRes.status === 401, `Invalid token /api/auth/me returns 401 (got ${meBadTokenRes.status})`);

    // 6c. Admin token
    const meAdminRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const meAdminData = await meAdminRes.json();
    assert(meAdminRes.status === 200, `Admin /api/auth/me returns 200 (got ${meAdminRes.status})`);
    assert(meAdminData.user?.role === 'admin', `Admin /api/auth/me returns role "admin"`);

    // 6d. User token
    const meUserRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    const meUserData = await meUserRes.json();
    assert(meUserRes.status === 200, `User /api/auth/me returns 200 (got ${meUserRes.status})`);
    assert(meUserData.user?.role === 'user', `User /api/auth/me returns role "user"`);

    // 7. Testing Unauthenticated Access to Admin-Only Endpoints (Must be 401)
    console.log('\n6. Testing Unauthenticated Access to Admin Endpoints (Expect 401)');
    const endpointsToTest = [
      { name: 'POST /api/departments', url: `${baseUrl}/api/departments`, method: 'POST', body: { name: 'Test', code: 'TST' } },
      { name: 'PUT /api/departments/fakeid', url: `${baseUrl}/api/departments/64b1f2345678901234567890`, method: 'PUT', body: { name: 'Test' } },
      { name: 'DELETE /api/departments/fakeid', url: `${baseUrl}/api/departments/64b1f2345678901234567890`, method: 'DELETE' },
      { name: 'POST /api/documents/upload', url: `${baseUrl}/api/documents/upload`, method: 'POST' },
      { name: 'DELETE /api/documents/fakeid', url: `${baseUrl}/api/documents/64b1f2345678901234567890`, method: 'DELETE' },
      { name: 'GET /api/drive/auth', url: `${baseUrl}/api/drive/auth`, method: 'GET' },
      { name: 'POST /api/drive/disconnect', url: `${baseUrl}/api/drive/disconnect`, method: 'POST' },
      { name: 'POST /api/drive/import', url: `${baseUrl}/api/drive/import`, method: 'POST', body: { fileId: '123' } }
    ];

    for (const ep of endpointsToTest) {
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : {},
        body: ep.body ? JSON.stringify(ep.body) : undefined
      });
      assert(res.status === 401, `Unauthenticated ${ep.name} returns 401 (got ${res.status})`);
    }

    // 8. Testing User (Non-Admin) Access to Admin-Only Endpoints (Must be 403 Forbidden)
    console.log('\n7. Testing "user" Role Access to Admin Endpoints (Expect 403 Forbidden)');
    for (const ep of endpointsToTest) {
      const headers = { Authorization: `Bearer ${userToken}` };
      if (ep.body) headers['Content-Type'] = 'application/json';

      const res = await fetch(ep.url, {
        method: ep.method,
        headers,
        body: ep.body ? JSON.stringify(ep.body) : undefined
      });
      assert(res.status === 403, `User role on ${ep.name} returns 403 Forbidden (got ${res.status})`);
    }

    // 9. Testing Admin Access to Protected Endpoints (Must NOT be 401 or 403)
    console.log('\n8. Testing Admin Access to Admin Endpoints');
    // Test drive auth with admin token:
    const driveAuthRes = await fetch(`${baseUrl}/api/drive/auth`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    // Can be 200 or 400 (if credentials not configured in dev env), but must NOT be 401 or 403
    assert(driveAuthRes.status !== 401 && driveAuthRes.status !== 403, `Admin on GET /api/drive/auth passed RBAC (status ${driveAuthRes.status})`);

    // 10. Testing Chat & History Protection (Unauthenticated must be 401, Authenticated user & admin must pass)
    console.log('\n9. Testing Chat & Conversation Protection');
    const chatEndpoints = [
      { name: 'GET /api/chat/conversations', url: `${baseUrl}/api/chat/conversations`, method: 'GET' },
      { name: 'GET /api/chat/history/session-default', url: `${baseUrl}/api/chat/history/session-default`, method: 'GET' },
      { name: 'POST /api/chat', url: `${baseUrl}/api/chat`, method: 'POST', body: { message: 'Hello' } }
    ];

    for (const ep of chatEndpoints) {
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : {},
        body: ep.body ? JSON.stringify(ep.body) : undefined
      });
      assert(res.status === 401, `Unauthenticated ${ep.name} returns 401 Unauthorized (got ${res.status})`);
    }

    // Authenticated user accessing chat conversations
    const userConvRes = await fetch(`${baseUrl}/api/chat/conversations`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert(userConvRes.status === 200, `Authenticated user on GET /api/chat/conversations returns 200 (got ${userConvRes.status})`);

    // Authenticated admin accessing chat conversations
    const adminConvRes = await fetch(`${baseUrl}/api/chat/conversations`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminConvRes.status === 200, `Authenticated admin on GET /api/chat/conversations returns 200 (got ${adminConvRes.status})`);

    // 11. Testing Public Endpoints (Must be accessible without token)
    console.log('\n10. Testing Public Endpoints');
    const pubDeptRes = await fetch(`${baseUrl}/api/departments`);
    assert(pubDeptRes.status === 200, `Public GET /api/departments returns 200 (got ${pubDeptRes.status})`);

    const pubDocsRes = await fetch(`${baseUrl}/api/documents`);
    assert(pubDocsRes.status === 200, `Public GET /api/documents returns 200 (got ${pubDocsRes.status})`);

    // Clean up test user
    await User.deleteOne({ email: 'test_student_rbac@college.edu' });

    console.log('\n=================================================');
    console.log(`RBAC Test Results: ${passed} passed, ${failed} failed`);
    console.log('=================================================');

    server.close();
    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    server.close();
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTests();
