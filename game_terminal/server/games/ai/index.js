// think(engine, input) -> Promise<result>: runs a board-game engine's bestMove in a shared,
// lazily-started worker thread. Requests queue in order; if the worker dies it's restarted on the
// next request and anything in flight rejects (callers fall back to a random legal move).

'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

let worker = null;
let nextId = 1;
const pending = new Map();

function failAll(err) {
  for (const { reject } of pending.values()) reject(err);
  pending.clear();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(__dirname, 'worker.js'));
  worker.unref();
  worker.on('message', ({ id, result, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(result);
  });
  worker.on('error', (err) => { worker = null; failAll(err); });
  worker.on('exit', () => { worker = null; failAll(new Error('ai worker exited')); });
  return worker;
}

function think(engine, input) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, engine, input });
  });
}

module.exports = { think };
