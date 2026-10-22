const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Document = require('./src/models/Document');

const BASE_URL = 'http://localhost:5000/api';
const { SIGLIP_BASE_URL } = require('./src/config/env');
const SIGLIP_URL = SIGLIP_BASE_URL || 'http://127.0.0.1:8000';

async function runTests() {
  console.log('===============================================================');
  console.log('    PHASE 5: GOOGLE DRIVE DOCUMENT INGESTION TEST SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;
  const credentialRequiredTests = [];

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  function markRequiresCredentials(testName, reason) {
    console.log(`[SKIP - CREDENTIALS REQUIRED] ${testName}: ${reason}`);
    credentialRequiredTests.push({ testName, reason });
  }

  try {
    const { MONGO_URI } = require('./src/config/env');
    await mongoose.connect(MONGO_URI);
    // -------------------------------------------------------------
    // Test 1 — Google Drive Configuration & Status API
    // -------------------------------------------------------------
    console.log('--- Test 1: Google Drive Status Endpoint ---');
    const statusRes = await fetch(`${BASE_URL}/drive/status`);
    const statusData = await statusRes.json();
    assert(
      statusRes.ok && statusData.success === true,
      `Drive status endpoint responsive (configured: ${statusData.configured}, authenticated: ${statusData.authenticated})`
    );

    // -------------------------------------------------------------
    // Test 2 — OAuth Authorization URL & Unconfigured Guard
    // -------------------------------------------------------------
    console.log('\n--- Test 2: OAuth Configuration & Authorization Guard ---');
    const authRes = await fetch(`${BASE_URL}/drive/auth`);
    const authData = await authRes.json();

    if (!statusData.configured) {
      assert(
        authRes.status === 400 && authData.message.includes('credentials not configured'),
        'Gracefully rejects auth URL generation when GOOGLE_CLIENT_ID / SECRET not in .env'
      );
      markRequiresCredentials(
        'Live Google Drive OAuth Login',
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set in server/.env'
      );
    } else {
      assert(
        authRes.ok && typeof authData.authUrl === 'string' && authData.authUrl.includes('accounts.google.com'),
        `Generated valid Google OAuth consent URL: ${authData.authUrl.substring(0, 40)}...`
      );
    }

    // -------------------------------------------------------------
    // Test 3 — OAuth Callback Error Handling
    // -------------------------------------------------------------
    console.log('\n--- Test 3: OAuth Callback Error Handling ---');
    // Verify that access_denied parameter from Google is handled safely without 500 error
    const callbackErrRes = await fetch(`${BASE_URL}/drive/callback?error=access_denied`, {
      redirect: 'manual'
    });
    // Should redirect to client URL with error notice
    assert(
      callbackErrRes.status === 302 && callbackErrRes.headers.get('location')?.includes('driveAuth=error'),
      'OAuth callback gracefully redirects to frontend on user rejection or error'
    );

    // -------------------------------------------------------------
    // Test 4 — Authentication Guard on Drive File Endpoints
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Authentication Guard on Protected Endpoints ---');
    const filesRes = await fetch(`${BASE_URL}/drive/files`);
    const filesData = await filesRes.json();
    if (!statusData.authenticated) {
      assert(
        filesRes.status === 401 && filesData.success === false,
        'GET /api/drive/files returns 401 Unauthorized when not authenticated'
      );
      markRequiresCredentials('Live Drive File Listing', 'Requires active Google Drive OAuth tokens');
      markRequiresCredentials('Live Drive File Download', 'Requires active Google Drive OAuth tokens');
    } else {
      assert(filesRes.ok && Array.isArray(filesData.files), 'GET /api/drive/files listed files successfully');
    }

    // -------------------------------------------------------------
    // Test 5 — Google Native Export & MIME Type Mapping Service Verification
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Google Drive Service Format Mapping ---');
    const googleDriveService = require('./src/services/google-drive.service');
    assert(
      googleDriveService.isSupported('application/vnd.google-apps.document'),
      'Google Docs (application/vnd.google-apps.document) recognized as supported'
    );
    assert(
      googleDriveService.isSupported('application/vnd.google-apps.spreadsheet'),
      'Google Sheets (application/vnd.google-apps.spreadsheet) recognized as supported'
    );
    assert(
      googleDriveService.isSupported('application/vnd.google-apps.presentation'),
      'Google Slides (application/vnd.google-apps.presentation) recognized as supported'
    );
    assert(
      googleDriveService.isSupported('application/pdf'),
      'Standard PDF format recognized as supported'
    );
    assert(
      googleDriveService.isSupported('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      'Standard DOCX format recognized as supported'
    );
    assert(
      !googleDriveService.isSupported('video/mp4', 'movie.mp4'),
      'Unsupported format (video/mp4) correctly rejected'
    );

    // -------------------------------------------------------------
    // Test 6 — Department Fetching
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Fetch Reference Department ---');
    const deptsRes = await fetch(`${BASE_URL}/departments`);
    const deptsData = await deptsRes.json();
    const cseDept = (deptsData.data || []).find((d) => d.code === 'CSE') || deptsData.data[0];
    const otherDept = (deptsData.data || []).find((d) => d.code === 'ECE') || deptsData.data[1];
    assert(!!cseDept, `Found reference department: ${cseDept.name} (${cseDept.code})`);

    // -------------------------------------------------------------
    // Test 7 — Ingest Document with Google Drive Source Metadata
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Google Drive Ingestion & Pipeline Execution ---');
    const fixturePdfPath = path.resolve(__dirname, 'test-fixtures/architecture_diagram.pdf');
    assert(fs.existsSync(fixturePdfPath), 'Found test PDF fixture');

    const testDriveFileId = `drive_file_id_${Date.now()}`;
    const importRes = await fetch(`${BASE_URL}/drive/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: testDriveFileId,
        departmentIds: [cseDept._id],
        simulatedFilePath: fixturePdfPath,
        originalFilename: 'CS8491_Computer_Architecture.pdf'
      })
    });
    const importData = await importRes.json();
    assert(
      importRes.ok && importData.success && importData.data,
      `Drive document imported & indexed via POST /api/drive/import (${importData.data?._id})`
    );

    const driveDoc = importData.data;

    // -------------------------------------------------------------
    // Test 8 — SigLIP2 Multimodal Image Indexing for Drive Document
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Multimodal Image Indexing for Drive Document ---');
    const Image = require('./src/models/Image');
    const driveImages = await Image.find({ documentId: driveDoc._id });
    assert(driveImages.length > 0, `Extracted ${driveImages.length} image(s) from Google Drive PDF`);

    if (driveImages.length > 0) {
      assert(
        driveImages[0].siglipEmbedding && driveImages[0].siglipEmbedding.length === 1152,
        `SigLIP2 generated 1152-dim embedding for Drive document diagram`
      );
    }

    // -------------------------------------------------------------
    // Test 9 — Duplicate Import Prevention Guard
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Duplicate Import Prevention ---');
    const dupRes = await fetch(`${BASE_URL}/drive/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: testDriveFileId,
        departmentIds: [cseDept._id]
      })
    });
    const dupData = await dupRes.json();
    assert(
      dupRes.status === 409 && dupData.duplicate === true,
      `Duplicate import prevention: rejected duplicate fileId with HTTP 409 (${dupData.message})`
    );

    // -------------------------------------------------------------
    // Test 10 — Multimodal RAG Retrieval with Google Drive Citations
    // -------------------------------------------------------------
    console.log('\n--- Test 10: RAG Query & Google Drive Citations ---');
    const chatRes = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Show me the CPU architecture diagram and explain its components from the Google Drive lecture notes.',
        sessionId: 'phase5-drive-test-session',
        departmentIds: [cseDept._id]
      })
    });
    const chatData = await chatRes.json();
    assert(chatRes.ok && chatData.success, 'RAG successfully queried over Google Drive document context');

    // Verify citations indicate Google Drive source
    const driveSources = (chatData.sources || []).filter(
      (s) =>
        s.source === 'google_drive' ||
        s.sourceType === 'Google Drive' ||
        (s.snippet && s.snippet.includes('Google Drive')) ||
        (s.label && s.label.includes('Google Drive'))
    );
    assert(
      driveSources.length > 0,
      `Citation correctly reflects source as Google Drive (${driveSources.length} citation(s) labeled)`
    );

    // Check image source in response
    const imageSources = (chatData.sources || []).filter((s) => s.type === 'image');
    assert(
      imageSources.length > 0,
      `Multimodal retrieval returned ${imageSources.length} diagram(s) from the Drive document`
    );

    // -------------------------------------------------------------
    // Test 11 — Department Filtering on Drive Documents
    // -------------------------------------------------------------
    console.log('\n--- Test 11: Department Isolation on Google Drive Document ---');
    const otherDeptRes = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What components are in the CPU architecture notes?',
        sessionId: 'phase5-isolation-session',
        departmentIds: [otherDept._id]
      })
    });
    const otherDeptData = await otherDeptRes.json();
    const leakedSources = (otherDeptData.sources || []).filter(
      (s) => s.filename.includes('CS8491_Computer_Architecture')
    );
    assert(
      leakedSources.length === 0,
      `Department isolation respected: CSE Google Drive document was NOT returned under ${otherDept.code}`
    );

    // -------------------------------------------------------------
    // Test 12 — Document Deletion and Clean Zero-Orphan Indexing
    // -------------------------------------------------------------
    console.log('\n--- Test 12: Deletion & Zero-Orphan Cleanup ---');
    const delRes = await fetch(`${BASE_URL}/documents/${driveDoc._id}`, {
      method: 'DELETE'
    });
    assert(delRes.ok, `Google Drive document deleted via DELETE /api/documents/:id`);

    const remainingDoc = await Document.findById(driveDoc._id);
    const remainingImages = await Image.find({ documentId: driveDoc._id });
    assert(!remainingDoc && remainingImages.length === 0, 'Document and Image records completely removed from MongoDB');

    // -------------------------------------------------------------
    // Test 13 — Local File Upload Regression (Phase 1–4 Integrity)
    // -------------------------------------------------------------
    console.log('\n--- Test 13: Local Upload Regression ---');
    const formData = new FormData();
    const pdfBlob = new Blob([fs.readFileSync(fixturePdfPath)], { type: 'application/pdf' });
    formData.append('files', pdfBlob, 'local_regression_doc.pdf');
    formData.append('departmentIds', JSON.stringify([cseDept._id]));

    const localUploadRes = await fetch(`${BASE_URL}/documents/upload`, {
      method: 'POST',
      body: formData
    });
    const localUploadData = await localUploadRes.json();
    assert(
      localUploadRes.ok && localUploadData.success,
      'Standard local file upload continues to work without disruption'
    );

    const localDocId = (localUploadData.data || [])[0]?._id;
    if (localDocId) {
      await fetch(`${BASE_URL}/documents/${localDocId}`, { method: 'DELETE' });
    }

    console.log('\n===============================================================');
    console.log(` PHASE 5 TEST SUITE FINISHED: ${passed} PASSED, ${failed} FAILED`);
    if (credentialRequiredTests.length > 0) {
      console.log(` SKIPPED DUE TO UNCONFIGURED REAL GOOGLE CREDS: ${credentialRequiredTests.length}`);
      credentialRequiredTests.forEach((t) => console.log(`   - ${t.testName}: ${t.reason}`));
    }
    console.log('===============================================================');

  } catch (err) {
    console.error('[Phase 5 Test Suite Error]', err);
    process.exit(1);
  }
}

runTests().then(() => {
  process.exit(0);
});
