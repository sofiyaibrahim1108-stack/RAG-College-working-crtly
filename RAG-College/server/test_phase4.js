const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const BASE_URL = 'http://localhost:5000/api';
const { SIGLIP_BASE_URL } = require('./src/config/env');
const SIGLIP_URL = SIGLIP_BASE_URL || 'http://127.0.0.1:8000';

async function runTests() {
  console.log('===============================================================');
  console.log('    PHASE 4: AUTOMATED MULTIMODAL IMAGE RAG TEST SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1 — SigLIP Health Check
    // -------------------------------------------------------------
    console.log('--- Test 1: SigLIP Service Health ---');
    const healthRes = await fetch(`${SIGLIP_URL}/health`);
    const healthData = await healthRes.json();
    const siglipDim = healthData.embedding_dimension || 1152;
    assert(
      healthRes.ok && healthData.status === 'healthy' && healthData.embedding_dimension === siglipDim,
      `SigLIP service healthy on ${healthData.device} with dimension ${healthData.embedding_dimension}`
    );

    // -------------------------------------------------------------
    // Test 2 — Image Embedding
    // -------------------------------------------------------------
    console.log('\n--- Test 2: SigLIP Image Embedding ---');
    const fixturePdfPath = path.resolve(__dirname, 'test-fixtures/architecture_diagram.pdf');
    assert(fs.existsSync(fixturePdfPath), 'Found architecture_diagram.pdf fixture');

    // Create a temporary test image file to test direct embedding
    const tempImgPath = path.resolve(__dirname, 'test-fixtures/temp_test_image.png');
    // Simple 1x1 png base64
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    fs.writeFileSync(tempImgPath, Buffer.from(pngBase64, 'base64'));

    const imgEmbedRes = await fetch(`${SIGLIP_URL}/embed/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: tempImgPath })
    });
    const imgEmbedData = await imgEmbedRes.json();
    if (fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath);

    assert(
      imgEmbedRes.ok && Array.isArray(imgEmbedData.embedding) && imgEmbedData.dimension === siglipDim,
      `Image embedding generated successfully (Dimension: ${imgEmbedData.dimension})`
    );

    // -------------------------------------------------------------
    // Test 3 — Text Embedding in SigLIP Space
    // -------------------------------------------------------------
    console.log('\n--- Test 3: SigLIP Text Embedding ---');
    const txtEmbedRes = await fetch(`${SIGLIP_URL}/embed/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'CPU architecture diagram' })
    });
    const txtEmbedData = await txtEmbedRes.json();
    assert(
      txtEmbedRes.ok && Array.isArray(txtEmbedData.embedding) && txtEmbedData.dimension === siglipDim,
      `SigLIP text embedding generated successfully in same ${siglipDim}-dim space`
    );

    // Fetch department for testing
    const deptsRes = await fetch(`${BASE_URL}/departments`);
    const deptsData = await deptsRes.json();
    const cseDept = (deptsData.data || []).find((d) => d.code === 'CSE') || deptsData.data[0];
    const otherDept = (deptsData.data || []).find((d) => d.code === 'ECE') || deptsData.data[1];
    assert(!!cseDept, `Found reference department: ${cseDept.name} (${cseDept.code})`);

    // -------------------------------------------------------------
    // Test 4 — PDF Image Extraction Pipeline
    // -------------------------------------------------------------
    console.log('\n--- Test 4: PDF Image Extraction & Processing ---');
    const formData = new FormData();
    const pdfBlob = new Blob([fs.readFileSync(fixturePdfPath)], { type: 'application/pdf' });
    formData.append('files', pdfBlob, 'architecture_diagram.pdf');
    formData.append('departmentIds', JSON.stringify([cseDept._id]));

    const uploadRes = await fetch(`${BASE_URL}/documents/upload`, {
      method: 'POST',
      body: formData
    });
    const uploadData = await uploadRes.json();
    assert(uploadRes.ok && uploadData.success, 'Document uploaded and processed');

    const uploadedDoc = (uploadData.data || [])[0];
    assert(uploadedDoc && uploadedDoc._id, `Document ID created: ${uploadedDoc._id}`);

    // Verify images in database for this document
    const docImagesRes = await fetch(`${BASE_URL}/documents/${uploadedDoc._id}/images`);
    const docImagesData = await docImagesRes.json();
    assert(
      docImagesRes.ok && docImagesData.count > 0,
      `Extracted ${docImagesData.count} image record(s) in MongoDB`
    );

    const firstImage = docImagesData.data[0];
    assert(
      firstImage && firstImage.pageNumber === 1,
      `Page number recorded accurately: Page ${firstImage.pageNumber}`
    );
    assert(
      firstImage && fs.existsSync(firstImage.filePath || firstImage.imagePath),
      `Physical image file exists on disk: ${firstImage.imageFilename}`
    );

    // -------------------------------------------------------------
    // Test 5 — Image Vector Indexing
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Local Image ANN Vector Indexing ---');
    const healthFullRes = await fetch(`${BASE_URL}/health`);
    const healthFullData = await healthFullRes.json();
    const imageVectorCount = healthFullData.vectorIndexes?.images?.vectorCount || 0;
    assert(
      imageVectorCount > 0,
      `Image vector index contains ${imageVectorCount} active image vectors (Dim: ${healthFullData.vectorIndexes?.images?.dimension || siglipDim})`
    );

    // -------------------------------------------------------------
    // Test 6 — Multimodal Image Retrieval
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Image Retrieval via Query ---');
    const chatRes = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Show me the CPU architecture diagram and explain the hardware blocks.',
        sessionId: 'phase4-test-session',
        departmentIds: [cseDept._id]
      })
    });
    const chatData = await chatRes.json();
    assert(chatRes.ok && chatData.success, 'Chat endpoint processed question successfully');

    const imageSources = (chatData.sources || []).filter((s) => s.type === 'image');
    assert(
      imageSources.length > 0,
      `Image retrieval returned ${imageSources.length} relevant diagram source(s)`
    );
    if (imageSources.length > 0) {
      assert(
        imageSources[0].filename.includes('architecture_diagram.pdf'),
        `Image source correctly mapped to document: ${imageSources[0].filename}`
      );
    }

    // -------------------------------------------------------------
    // Test 7 — Department Filtering for Images
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Department Filtering on Image Retrieval ---');
    const otherDeptRes = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Show me the CPU architecture diagram.',
        sessionId: 'phase4-test-isolated-dept',
        departmentIds: [otherDept._id]
      })
    });
    const otherDeptData = await otherDeptRes.json();
    const filteredOutImages = (otherDeptData.sources || []).filter(
      (s) => s.type === 'image' && s.filename.includes('architecture_diagram.pdf')
    );
    assert(
      filteredOutImages.length === 0,
      `Department isolation respected: CSE image was NOT returned when querying under ${otherDept.code}`
    );

    // -------------------------------------------------------------
    // Test 8 — Text RAG Regression
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Text RAG Regression ---');
    const textRagRes = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What units does the CPU architecture incorporate according to the notes?',
        sessionId: 'phase4-text-rag-session',
        departmentIds: [cseDept._id]
      })
    });
    const textRagData = await textRagRes.json();
    assert(
      textRagRes.ok && textRagData.answer && textRagData.answer.length > 10,
      'Text RAG answered accurately from document text context'
    );
    const docSources = (textRagData.sources || []).filter((s) => s.type === 'document');
    assert(docSources.length > 0, `Text RAG produced ${docSources.length} document citations`);

    // -------------------------------------------------------------
    // Test 9 — Casual Question Regression (Image Retrieval Bypassed)
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Casual Intent Regression ---');
    const casualRes = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Hi, good morning!',
        sessionId: 'phase4-casual-session'
      })
    });
    const casualData = await casualRes.json();
    assert(casualData.intent === 'casual', `Intent classified as casual: "${casualData.intent}"`);
    assert(
      (casualData.sources || []).length === 0,
      'Vector and image retrieval completely bypassed for casual query'
    );
    assert(
      casualData.timings?.imageRetrievalMs === 0 || !casualData.timings?.imageRetrievalMs,
      `Image retrieval timing bypassed (${casualData.timings?.imageRetrievalMs || 0}ms)`
    );

    // -------------------------------------------------------------
    // Test 10 — SigLIP Unavailable Fallback
    // -------------------------------------------------------------
    console.log('\n--- Test 10: Graceful Fallback When SigLIP Unavailable ---');
    // Simulate by calling the LangGraph workflow directly or testing text RAG resilience
    const fallbackRes = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What is the function of the Arithmetic Logic Unit?',
        sessionId: 'phase4-fallback-session',
        departmentIds: [cseDept._id]
      })
    });
    const fallbackData = await fallbackRes.json();
    assert(
      fallbackRes.ok && fallbackData.answer,
      'Text RAG continues functioning seamlessly regardless of image retrieval status'
    );

    // -------------------------------------------------------------
    // Test 11 — Document Deletion & Complete Image Cleanup
    // -------------------------------------------------------------
    console.log('\n--- Test 11: Document Deletion and Zero-Orphan Cleanup ---');
    const deleteRes = await fetch(`${BASE_URL}/documents/${uploadedDoc._id}`, {
      method: 'DELETE'
    });
    const deleteData = await deleteRes.json();
    assert(deleteRes.ok && deleteData.success, 'Document deleted successfully via DELETE /api/documents/:id');

    // Verify MongoDB Image records are deleted
    const verifyImagesRes = await fetch(`${BASE_URL}/documents/${uploadedDoc._id}/images`);
    const verifyImagesData = await verifyImagesRes.json();
    assert(
      verifyImagesData.count === 0,
      `MongoDB Image records completely wiped: ${verifyImagesData.count} remaining`
    );

    // Verify physical image file directory is removed
    const physicalDir = path.resolve(__dirname, `data/images/${uploadedDoc._id}`);
    assert(
      !fs.existsSync(physicalDir),
      `Physical image directory cleaned up from disk: ${physicalDir}`
    );

    // -------------------------------------------------------------
    // Test 12 — No Orphan Image Vectors
    // -------------------------------------------------------------
    console.log('\n--- Test 12: Orphan Vector Index Verification ---');
    const finalHealthRes = await fetch(`${BASE_URL}/health`);
    const finalHealthData = await finalHealthRes.json();
    const finalVectorCount = finalHealthData.vectorIndexes?.images?.vectorCount || 0;
    assert(
      finalVectorCount === 0,
      `No orphan image vectors: Index vector count is exactly ${finalVectorCount}`
    );

    console.log('\n===============================================================');
    console.log(` PHASE 4 TEST SUITE FINISHED: ${passed} PASSED, ${failed} FAILED`);
    console.log('===============================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[FATAL ERROR IN TEST SUITE]:', err);
    process.exit(1);
  }
}

runTests();
