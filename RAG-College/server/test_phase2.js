const fs = require('fs');
const path = require('path');

async function runTests() {
  console.log('=== Starting Phase 2 Verification ===\n');

  // 1. Fetch departments to get valid IDs
  const deptRes = await fetch('http://localhost:5000/api/departments');
  const deptsJson = await deptRes.json();
  const depts = deptsJson.data;
  console.log(`[Test 1] Available departments in DB: ${depts.map((d) => `${d.code} (${d._id})`).join(', ')}`);

  const cseDept = depts.find((d) => d.code === 'CSE') || depts[0];
  const aidsDept = depts.find((d) => d.code === 'AI & DS') || depts[1];
  const mcaDept = depts.find((d) => d.code === 'MCA') || depts[2];

  // 2. Test: Upload ONE PDF assigned to ONE department (CSE)
  console.log('\n[Test 2] Uploading 1 PDF assigned to 1 department (CSE)...');
  const pdfForm = new FormData();
  const pdfBlob = new Blob([fs.readFileSync(path.join(__dirname, 'test-fixtures/college_guide.pdf'))]);
  pdfForm.append('files', pdfBlob, 'college_guide.pdf');
  pdfForm.append('departmentIds', JSON.stringify([cseDept._id]));

  const pdfRes = await fetch('http://localhost:5000/api/documents/upload', {
    method: 'POST',
    body: pdfForm
  });
  const pdfJson = await pdfRes.json();
  console.log('Upload single PDF response:', {
    success: pdfJson.success,
    count: pdfJson.count,
    filename: pdfJson.data?.[0]?.originalFilename,
    status: pdfJson.data?.[0]?.status,
    pageCount: pdfJson.data?.[0]?.metadata?.pageCount,
    assignedDepts: pdfJson.data?.[0]?.departmentIds?.map((d) => d.code)
  });

  // 3. Test: Upload MULTIPLE files assigned to MULTIPLE departments (CSE, AI & DS, MCA)
  console.log('\n[Test 3] Uploading multiple files (XLSX, CSV, TXT) assigned to multiple departments...');
  const multiForm = new FormData();
  multiForm.append('files', new Blob([fs.readFileSync(path.join(__dirname, 'test-fixtures/curriculum.xlsx'))]), 'curriculum.xlsx');
  multiForm.append('files', new Blob([fs.readFileSync(path.join(__dirname, 'test-fixtures/students.csv'))]), 'students.csv');
  multiForm.append('files', new Blob([fs.readFileSync(path.join(__dirname, 'test-fixtures/algorithms.txt'))]), 'algorithms.txt');
  multiForm.append('departmentIds', JSON.stringify([cseDept._id, aidsDept._id, mcaDept._id]));

  const multiRes = await fetch('http://localhost:5000/api/documents/upload', {
    method: 'POST',
    body: multiForm
  });
  const multiJson = await multiRes.json();
  console.log('Upload multiple files response:', {
    success: multiJson.success,
    count: multiJson.count,
    files: multiJson.data?.map((d) => ({
      name: d.originalFilename,
      status: d.status,
      sheets: d.metadata?.sheetNames,
      rows: d.metadata?.rowCount,
      assignedDepts: d.departmentIds?.map((x) => x.code)
    }))
  });

  // 4. Test: Unsupported file rejection
  console.log('\n[Test 4] Testing unsupported file rejection (.exe)...');
  const badForm = new FormData();
  badForm.append('files', new Blob([fs.readFileSync(path.join(__dirname, 'test-fixtures/unsupported.exe'))]), 'unsupported.exe');
  badForm.append('departmentIds', JSON.stringify([cseDept._id]));

  const badRes = await fetch('http://localhost:5000/api/documents/upload', {
    method: 'POST',
    body: badForm
  });
  const badJson = await badRes.json();
  console.log('Unsupported file response (should fail):', {
    status: badRes.status,
    success: badJson.success,
    message: badJson.message
  });

  // 5. Test: Corrupted/empty file processing error handling
  console.log('\n[Test 5] Testing empty/corrupted file processing failure handling...');
  const corruptForm = new FormData();
  corruptForm.append('files', new Blob([fs.readFileSync(path.join(__dirname, 'test-fixtures/corrupted_sample.pdf'))]), 'corrupted_sample.pdf');
  corruptForm.append('departmentIds', JSON.stringify([cseDept._id]));

  const corruptRes = await fetch('http://localhost:5000/api/documents/upload', {
    method: 'POST',
    body: corruptForm
  });
  const corruptJson = await corruptRes.json();
  console.log('Corrupted file response (should record status=failed and error):', {
    status: corruptRes.status,
    success: corruptJson.success,
    fileStatus: corruptJson.data?.[0]?.status,
    processingError: corruptJson.data?.[0]?.processingError
  });

  // 6. Test: Verify MongoDB records & Department document counts
  console.log('\n[Test 6] Verifying all documents stored in MongoDB...');
  const allDocsRes = await fetch('http://localhost:5000/api/documents');
  const allDocsJson = await allDocsRes.json();
  console.log(`Total documents in MongoDB: ${allDocsJson.count}`);
  allDocsJson.data.forEach((d) => {
    console.log(` - [${d.fileType.toUpperCase()}] ${d.originalFilename} | Status: ${d.status} | Depts: [${d.departmentIds.map((x) => x.code).join(', ')}] | Error: ${d.processingError || 'None'}`);
  });

  // 7. Check updated department document counts
  const updatedDeptRes = await fetch('http://localhost:5000/api/departments');
  const updatedDeptsJson = await updatedDeptRes.json();
  console.log('\n[Test 7] Updated department document counts:');
  updatedDeptsJson.data.forEach((d) => {
    console.log(` - ${d.code}: ${d.documentCount} documents`);
  });

  console.log('\n=== Phase 2 Verification Complete ===');
}

runTests().catch(console.error);
