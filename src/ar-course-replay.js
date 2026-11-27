// Recording uses a fresh physics instance in a worker so generating the clip
// cannot change the time, PID history or car position in the visible simulator.
export async function recordArCourseReplay({ signal, ...options } = {}) {
  signal?.throwIfAborted();
  const worker = new Worker(new URL('./ar-course-replay-worker.js', import.meta.url), { type: 'module' });
  let cancel;
  try {
    return await new Promise((resolve, reject) => {
      cancel = () => reject(signal.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      worker.onmessage = ({ data }) => {
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      };
      worker.onerror = event => reject(new Error(event.message || 'Could not start the AR simulation.'));
      worker.onmessageerror = () => reject(new Error('Could not read the AR simulation result.'));
      worker.postMessage(options);
    });
  } finally {
    signal?.removeEventListener('abort', cancel);
    worker.terminate();
  }
}
