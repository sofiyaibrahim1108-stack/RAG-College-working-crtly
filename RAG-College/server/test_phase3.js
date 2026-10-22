async function testPhase3() {
  console.log('=== Starting Phase 3 Core RAG Verification ===\n');

  // Test 1: Casual question (MUST bypass embedding & vector search)
  console.log('[Test 1] Testing Casual Intent: "Hi, good morning!"');
  const t0 = Date.now();
  const res1 = await fetch('http://localhost:5000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hi, good morning!', sessionId: 'test-session-1' })
  });
  const data1 = await res1.json();
  console.log('Casual Response:', {
    intent: data1.intent,
    answer: data1.answer,
    sourcesCount: data1.sources?.length,
    timings: data1.timings,
    totalWallMs: Date.now() - t0
  });

  // Verify that embedding and retrieval were bypassed (should be undefined or 0)
  if (!data1.timings?.embeddingMs && !data1.timings?.retrievalMs) {
    console.log(' Verified: Embedding and vector retrieval were completely bypassed for casual query!');
  } else {
    console.error(' FAILED: Embedding or retrieval occurred during casual query!');
  }

  // Test 2: System question (MUST query MongoDB directly)
  console.log('\n[Test 2] Testing System Intent: "What departments are available?"');
  const res2 = await fetch('http://localhost:5000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What departments are available?', sessionId: 'test-session-1' })
  });
  const data2 = await res2.json();
  console.log('System Response:', {
    intent: data2.intent,
    answer: data2.answer,
    timings: data2.timings
  });

  // Test 3: RAG question with department detection: "What is QuickSort in CSE?"
  console.log('\n[Test 3] Testing Academic RAG with Department Detection (CSE): "What is the time complexity of QuickSort in algorithms?"');
  const res3 = await fetch('http://localhost:5000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'What is the time complexity of QuickSort in algorithms?',
      sessionId: 'test-session-1'
    })
  });
  const data3 = await res3.json();
  console.log('RAG Response:', {
    intent: data3.intent,
    departments: data3.departments,
    answer: data3.answer,
    sources: data3.sources?.map((s) => s.label || s.filename),
    timings: data3.timings
  });

  // Test 4: Multi-department tabular query: "What subjects and credits are listed in curriculum.xlsx?"
  console.log('\n[Test 4] Testing Spreadsheet Multi-Department Retrieval: "What subjects and credits are listed in the curriculum?"');
  const res4 = await fetch('http://localhost:5000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'What subjects and credits are listed in the curriculum?',
      sessionId: 'test-session-1'
    })
  });
  const data4 = await res4.json();
  console.log('Tabular RAG Response:', {
    intent: data4.intent,
    departments: data4.departments,
    answer: data4.answer,
    sources: data4.sources?.map((s) => s.label || s.filename),
    timings: data4.timings
  });

  // Test 5: Verify MongoDB persistence of conversation and messages
  console.log('\n[Test 5] Verifying MongoDB Conversation & Message storage...');
  const histRes = await fetch('http://localhost:5000/api/chat/history/test-session-1');
  const histData = await histRes.json();
  console.log(`Saved messages for test-session-1: ${histData.count}`);
  histData.data.forEach((m) => {
    console.log(` - [${m.role.toUpperCase()}] ${m.content.slice(0, 50)}... | Intent: ${m.detectedIntent || 'none'} | Sources: ${m.sources?.length || 0}`);
  });

  console.log('\n=== Phase 3 Verification Complete ===');
}

testPhase3().catch(console.error);
