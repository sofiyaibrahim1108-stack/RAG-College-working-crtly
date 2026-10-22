const { AutoTokenizer, AutoModelForSequenceClassification } = require('@xenova/transformers');

async function runBenchmark() {
  console.log('--- 1. Model Loading Started ---');
  const t0 = Date.now();

  const model_id = 'Xenova/bge-reranker-base';
  const tokenizer = await AutoTokenizer.from_pretrained(model_id);
  const model = await AutoModelForSequenceClassification.from_pretrained(model_id, {
    quantized: true
  });
  console.log(`Model Loaded in: ${((Date.now() - t0) / 1000).toFixed(2)}s`);

  const query = "how many modules are mentioned in python and explain each";

  const candidateTexts = [
    "A module in Python is a file containing definitions and statements like calculator.py with functions add, multiply and brand PyCalc.",
    "The curriculum covers 27 modules for R Programming and Data Analytics with framework concepts.",
    "Python standard library modules include math, random, os, sys, and datetime.",
    "EfficientNetB0 deep learning model for eye disease detection using diabetic retinopathy dataset.",
    "JavaScript functions and DOM manipulation guide for web browsers.",
    "In Python, modules are imported using import, from import, or as alias.",
    "Diabetic retinopathy classification using OpenCV preprocessing and TensorFlow.",
    "Python modules enable code reusability and organization into logical namespaces."
  ];

  console.log(`\n--- 2. Reranking ${candidateTexts.length} Candidates ---`);
  const tRerankStart = Date.now();

  const results = [];
  for (let i = 0; i < candidateTexts.length; i++) {
    const text = candidateTexts[i];

    // Tokenize query + text pair
    const inputs = await tokenizer(query, {
      text_pair: text,
      padding: true,
      truncation: true,
      max_length: 512
    });

    // Run direct model inference
    const { logits } = await model(inputs);
    
    // Sigmoid function to normalize raw logit to 0-1 scale
    const rawScore = logits.data[0];
    const normalizedScore = 1 / (1 + Math.exp(-rawScore));

    results.push({
      index: i + 1,
      rawLogit: Number(rawScore.toFixed(3)),
      score: Number(normalizedScore.toFixed(4)),
      snippet: text.slice(0, 60) + '...'
    });
  }

  const rerankDuration = Date.now() - tRerankStart;
  console.log(`\nTotal Reranking Time: ${rerankDuration}ms (~${(rerankDuration / 1000).toFixed(2)}s)`);
  console.log(`Average per chunk: ${(rerankDuration / candidateTexts.length).toFixed(1)}ms`);

  results.sort((a, b) => b.score - a.score);
  console.log('\n--- 3. Top Ranked Results ---');
  console.table(results);
}

runBenchmark().catch(console.error);