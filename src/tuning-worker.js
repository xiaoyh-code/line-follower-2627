import { runTuning, TUNING_TRIALS } from './tuning.js';

self.onmessage = async ({ data }) => {
  try {
    const { bestIndex, total, horizon } = await runTuning(data, trial => {
      self.postMessage({ type: 'trial', trial, total: TUNING_TRIALS });
    });
    self.postMessage({ type: 'done', bestIndex, total, horizon });
  } catch (error) {
    self.postMessage({ type: 'error', code: error?.code || 'TRIAL_FAILED', message: String(error?.message || error) });
  }
};
