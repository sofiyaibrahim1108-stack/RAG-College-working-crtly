const assert = require('assert');
const path = require('path');
const mongoose = require('mongoose');

// Connect to MongoDB
const { MONGO_URI } = require('./src/config/env');
const { routeQuery } = require('./src/services/router.service');
const { isTabularQuery, executeTabularQuery } = require('./src/services/tabular.service');

async function runTests() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.\n');

  try {
    // -------------------------------------------------------------
    // Test 1: Ambiguous lowest query (MUST return clarification, not assume Math)
    // -------------------------------------------------------------
    console.log('[Test 1] Ambiguous query: "Who scored the lowest?"');
    const res1 = await executeTabularQuery('Who scored the lowest?');
    console.log('Answer:', res1.answer);
    console.log('Operation:', res1.operation);
    assert(res1.operation === 'CLARIFICATION_NEEDED', 'Expected CLARIFICATION_NEEDED for ambiguous query');
    assert(res1.answer.includes('contains multiple numeric columns'), 'Clarification should list numeric columns');
    console.log('Test 1 PASSED.\n');

    // -------------------------------------------------------------
    // Test 2: Lowest Math with ties (Specific column requested)
    // -------------------------------------------------------------
    console.log('[Test 2] Specific lowest query: "Who scored the lowest in Math?"');
    const res2 = await executeTabularQuery('Who scored the lowest in Math?');
    console.log('Answer:\n', res2.answer);
    assert(res2.operation === 'MIN', 'Expected MIN operation');
    assert(res2.answer.includes('The lowest score in Math is'), 'Should report lowest score in Math');
    assert(res2.sources.length === 1, 'Should provide 1 isolated source');
    console.log('Test 2 PASSED.\n');

    // -------------------------------------------------------------
    // Test 3: Grade C count + names (Categorical filter dynamically identified)
    // -------------------------------------------------------------
    console.log('[Test 3] Categorical count query: "How many students got Grade C?"');
    const res3 = await executeTabularQuery('How many students got Grade C?');
    console.log('Answer:\n', res3.answer);
    assert(res3.operation === 'COUNT', 'Expected COUNT operation');
    assert(res3.answer.includes("Grade 'C'"), 'Should report Grade C count');
    assert(res3.sources[0].actualValues.filterCol === 'Grade', 'Dynamic filterCol should be Grade');
    assert(res3.sources[0].actualValues.filterVal === 'C', 'Dynamic filterVal should be C');
    console.log('Test 3 PASSED.\n');

    // -------------------------------------------------------------
    // Test 4: Dynamic status count: "How many passed?"
    // -------------------------------------------------------------
    console.log('[Test 4] Dynamic status count: "How many passed?"');
    const res4 = await executeTabularQuery('How many passed?');
    console.log('Answer:\n', res4.answer);
    assert(res4.operation === 'COUNT', 'Expected COUNT operation');
    assert(res4.sources[0].actualValues.filterCol === 'Status', 'Dynamic filterCol should be Status');
    assert(res4.sources[0].actualValues.filterVal === 'Pass', 'Dynamic filterVal should be Pass');
    console.log('Test 4 PASSED.\n');

    // -------------------------------------------------------------
    // Test 5: Multi-column lookup: "What is the Math and Science mark of Ananya Iyer?"
    // -------------------------------------------------------------
    console.log('[Test 5] Multi-column lookup: "What is the Math and Science mark of Ananya Iyer?"');
    const res5 = await executeTabularQuery('What is the Math and Science mark of Ananya Iyer?');
    console.log('Answer:\n', res5.answer);
    assert(res5.operation === 'LOOKUP_MULTI', 'Expected LOOKUP_MULTI');
    assert(res5.answer.includes('Math') && res5.answer.includes('Science'), 'Should contain both Math and Science');
    console.log('Test 5 PASSED.\n');

    // -------------------------------------------------------------
    // Test 6: Missing column check: "What is the History mark of Ananya Iyer?"
    // -------------------------------------------------------------
    console.log('[Test 6] Missing column check: "What is the History mark of Ananya Iyer?"');
    const res6 = await executeTabularQuery('What is the History mark of Ananya Iyer?');
    console.log('Answer:\n', res6.answer);
    assert(res6.operation === 'MISSING_COLUMN_CHECK', 'Expected MISSING_COLUMN_CHECK');
    assert(res6.answer.includes('History'), 'Should report missing History column');
    console.log('Test 6 PASSED.\n');

    // -------------------------------------------------------------
    // Test 7: Lowest Average
    // -------------------------------------------------------------
    console.log('[Test 7] Lowest Average: "What is the lowest Average?"');
    const res7 = await executeTabularQuery('What is the lowest Average?');
    console.log('Answer:\n', res7.answer);
    assert(res7.operation === 'MIN', 'Expected MIN');
    assert(res7.answer.includes('Average'), 'Should calculate lowest Average');
    console.log('Test 7 PASSED.\n');

    // -------------------------------------------------------------
    // Test 8: Total row count: "How many total records in the spreadsheet?"
    // -------------------------------------------------------------
    console.log('[Test 8] Total row count: "How many total records are in the spreadsheet?"');
    const res8 = await executeTabularQuery('How many total records are in the spreadsheet?');
    console.log('Answer:\n', res8.answer);
    assert(res8.operation === 'COUNT_ALL', 'Expected COUNT_ALL');
    assert(res8.answer.includes('total records'), 'Should report total records');
    console.log('Test 8 PASSED.\n');

    // -------------------------------------------------------------
    // Test 9: Router generic behavior without "retinopathy"
    // -------------------------------------------------------------
    console.log('[Test 9] Router query without retinopathy patch');
    const routeCasual = await routeQuery('Hi how are you?');
    assert(routeCasual.intent === 'casual', 'Expected casual intent for greeting');
    console.log('Casual route:', routeCasual.intent, 'OK');

    const routeRetinopathy = await routeQuery('Tell me about diabetic retinopathy');
    assert(routeRetinopathy.intent === 'rag', 'Expected rag intent for diabetic retinopathy');
    console.log('Retinopathy route:', routeRetinopathy.intent, 'OK');
    console.log('Test 9 PASSED.\n');

    // -------------------------------------------------------------
    // Test 10: Generic visual query intent
    // -------------------------------------------------------------
    console.log('[Test 10] Visual query generic intent via semantic router');
    const vq1 = await routeQuery('Show me the diagram of network architecture');
    assert(vq1.isVisualQuery === true, 'Should be visual');
    const vq2 = await routeQuery('Show me the screenshot of user interface');
    assert(vq2.isVisualQuery === true, 'Should be visual');
    const vq3 = await routeQuery('What is the enrollment figure?');
    assert(vq3.isVisualQuery === false, 'Should NOT be visual');
    const vq4 = await routeQuery('Tell me about diabetic retinopathy');
    assert(vq4.isVisualQuery === false, 'Should NOT be visual');
    console.log('Test 10 PASSED.\n');

    // -------------------------------------------------------------
    // Test 11: Dynamic, 100% data-driven Department Aliases
    // -------------------------------------------------------------
    console.log('[Test 11] Dynamic Department Aliases from MongoDB');
    const Department = require('./src/models/Department');
    const tempDept = await Department.create({
      name: 'Aerospace Systems Engineering',
      code: 'AERO_SYS',
      aliases: ['space technology', 'orbital mechanics', 'propulsion']
    });

    try {
      const routeDynamic = await routeQuery('What are the key concepts in space technology?');
      console.log('Detected departments:', routeDynamic.departments);
      assert(routeDynamic.departments.includes('AERO_SYS'), 'Should dynamically detect AERO_SYS from space technology alias');
      console.log('Dynamic department alias match PASSED.');
    } finally {
      await Department.findByIdAndDelete(tempDept._id);
    }
    console.log('Test 11 PASSED.\n');

    console.log('=============================================');
    console.log('ALL 11 GENERALIZATION TESTS PASSED SUCCESSFULLY');
    console.log('=============================================');
  } finally {
    await mongoose.disconnect();
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
