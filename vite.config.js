import {defineConfig} from 'vite';

// The tuning worker loads the single-threaded MuJoCo WASM build as an ES module.
export default defineConfig({
  worker: {format: 'es'},
});
