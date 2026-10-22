const { performance } = require('perf_hooks');

class PipelineTimer {
  constructor() {
    this.stages = {};
    this.startTimes = {};
    this.overallStart = performance.now();
  }

  start(stageName) {
    this.startTimes[stageName] = performance.now();
  }

  end(stageName) {
    if (this.startTimes[stageName]) {
      const elapsed = performance.now() - this.startTimes[stageName];
      this.stages[stageName] = {
        ms: Math.round(elapsed),
        status: 'executed'
      };
      delete this.startTimes[stageName];
    }
  }

  skip(stageName) {
    this.stages[stageName] = {
      ms: null,
      status: 'N/A'
    };
  }

  getMetrics() {
    const totalMs = Math.round(performance.now() - this.overallStart);
    return {
      stages: this.stages,
      totalMs
    };
  }
}

module.exports = { PipelineTimer };