/**
 * cluster.js — Node.js cluster for Railway multi-core deployment
 *
 * Railway instances have 2 vCPUs. Without cluster, 1 CPU sits idle.
 * This spawns 1 worker per CPU, doubling throughput with no code changes.
 * Each worker is an independent Express process — zero shared state needed.
 *
 * Usage: In Procfile, change:
 *   web: node src/app.js
 * To:
 *   web: node cluster.js
 */

import cluster from 'cluster';
import os from 'os';

const NUM_WORKERS = process.env.NODE_CLUSTER_WORKERS
  ? parseInt(process.env.NODE_CLUSTER_WORKERS)
  : Math.min(os.cpus().length, 4);  // cap at 4 to avoid memory pressure

if (cluster.isPrimary) {
  console.log(`[cluster] Primary PID ${process.pid} — spawning ${NUM_WORKERS} workers`);

  for (let i = 0; i < NUM_WORKERS; i++) cluster.fork();

  cluster.on('exit', (worker, code, signal) => {
    console.log(`[cluster] Worker ${worker.process.pid} died (${signal || code}) — respawning`);
    cluster.fork();
  });

  cluster.on('online', (worker) => {
    console.log(`[cluster] Worker ${worker.process.pid} online`);
  });
} else {
  // Workers import and start the actual Express app
  import('./src/app.js');
}
