import { Worker } from 'cluster';
const cluster = require('cluster');
const os = require('os');

interface workerStructure 
{
    worker: any,
    code: any,
    signal: any
}

var workers: Array<Worker> = []

if (cluster.isPrimary) {
  console.log(`The PPID ${process.pid} is running.`);

  // I create a worker by every CPU to use the full capacity of the instance.
  for (let i = 0; i < os.cpus().length; i++) {
    let newWorker = cluster.fork();
    workers.push(newWorker);
  }

  // catching exit signal
  cluster.on('exit', (workerData: workerStructure) => {
    console.log(`Worker ${workerData.worker.process.pid} exited with code ${workerData.code} and signal ${workerData.signal}.`);
    cluster.fork();
  });
} else {
  console.log(`Worker with PID: ${process.pid} is running.`);

  // ... Acá debería agregar la lógica de los workers, tal vez debería desacoplar acá ...
}