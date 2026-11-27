// A recorder owns an independent simulation for one track and vehicle.
export function createArCourseRecorder({ course, physical } = {}) {
  const worker = new Worker(new URL('./ar-course-replay-worker.js', import.meta.url), { type: 'module' });
  let request;
  let first = true;
  let disposed;

  worker.onmessage = ({ data }) => {
    if (data.error) request?.reject(new Error(data.error));
    else request?.resolve(data);
  };
  worker.onerror = event => dispose(new Error(event.message || 'Could not start the AR simulation.'));
  worker.onmessageerror = () => dispose(new Error('Could not read the AR simulation result.'));

  async function record(params) {
    if (disposed) throw disposed;
    if (request) throw new Error('A replay is already being recorded.');
    try {
      return await new Promise((resolve, reject) => {
        request = { resolve, reject };
        worker.postMessage(first ? { course, physical, params } : { params });
        first = false;
      });
    } finally {
      request = null;
    }
  }

  function dispose(reason = new DOMException('Replay cancelled.', 'AbortError')) {
    if (disposed) return;
    disposed = reason;
    worker.terminate();
    request?.reject(reason);
  }

  return { record, dispose };
}

export async function recordArCourseReplay({ signal, params, ...options } = {}) {
  signal?.throwIfAborted();
  const recorder = createArCourseRecorder(options);
  const cancel = () => recorder.dispose(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    return await recorder.record(params);
  } finally {
    signal?.removeEventListener('abort', cancel);
    recorder.dispose();
  }
}
