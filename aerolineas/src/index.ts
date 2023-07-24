import os from 'os';
import express from 'express';
import httpProxy from 'http-proxy';
import cluster from 'cluster';
import {Worker} from 'cluster';
import { createMessage, createFlightOffer } from './services/controller';

const numCPUs = os.cpus().length;
const workers: Worker[] = [];
let workersPorts: { workerPID: number; port: number }[] = [];
let previousPort = 3002;

interface MessageWorker {
  type: string;
  data: string[];
}

function getNextPortRR(port_from_server: string){
  const workersOnlyPorts = workersPorts.map(value => value.port);
  //let index = workersOnlyPorts.indexOf(parseInt(process.env.PORT));
  //Con la línea de abajo andaba
  //let index = workersOnlyPorts.indexOf(previousPort);
  let index = workersOnlyPorts.indexOf(parseInt(port_from_server));
  console.log(parseInt(port_from_server));
  console.log(workersOnlyPorts);
  console.log('indice determinado:');
  console.log(index);

  let nextPort = (index === workersOnlyPorts.length - 1) ? 3000 : workersOnlyPorts[index + 1];
  console.log('puerto determinado');
  console.log(nextPort);

  return nextPort;
}

function isWorkerAvailable(pid: number): boolean {
  try {
    // Intentamos enviar una señal al proceso del worker con el PID dado
    // Si el proceso está vivo, esto no generará una excepción y devolverá true
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Si el proceso no está vivo, la excepción se captura y devolvemos false
    return false;
  }
}

/* function delay(time: number) {
  return new Promise(resolve => setTimeout(resolve, time));
} */

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);
  const workersData: string[] = [];
  for (let i = 0; i < numCPUs; i++) {
    let newWorker = cluster.fork({ PORT: 3000 + i });
    workers.push(newWorker);
    workersData.push(JSON.stringify({ workerPID: newWorker.process.pid, port: 3000 + i }));
  }

  const message = {
    type: 'WorkersPorts',
    data: workersData,
  };
  for (const id in cluster.workers) {
    cluster.workers[id]?.send(message);
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died`);
    cluster.fork({ PORT: 3000 + workers.length }); // Reemplazar el worker muerto con uno nuevo en el siguiente puerto disponible
  });
} else {
  workersPorts = [];
  process.on('message', (message:MessageWorker) => {
    switch (message.type) {
      case 'WorkersPorts':
        workersPorts = message.data.map(val => JSON.parse(val));
        console.log(`Master received result from Worker ${cluster.worker?.process.pid}: ${message.type}`);
        break;
      // Agregar más casos según los tipos de mensajes que necesite manejar
    }
    // Cuando el worker recibe un mensaje, mostramos el valor recibido
    // console.log(`Worker ${cluster.worker?.process.pid} received message: ${message}`);
  });

  const app = express();
  app.get('/', (req, res) => {
    res.writeHead(200);
    res.end(`Hello world!\n I am the pid ${process.pid}`);
  });

  app.get('/tryme', (req, res) => {
    //delay(200);
    res.writeHead(200);
    res.end(`Try me! Hello world!\n I am the pid ${process.pid} listening at port ${process.env.PORT}`);
  });

  app.get('/createflight', (req, res) => {
    let flightMock = { when: "20230909", price: 43.5, airline: "Aerolineas", origin: "Buenos Aires", destination: "Miami", seats: 23 }
    createFlightOffer(flightMock);
    res.send(`Flight Created by ${process.pid}`);
});

app.get('/queue', (req, res) => {
  createMessage()
  res.send('Queue message created');
});

  const serverPort: string = process.env.PORT || '3000';
  const server = app.listen(process.env.PORT, () => {
    console.log(`Worker ${process.pid} started`);

    const proxy = httpProxy.createProxyServer({});
    const app2 = express();

    app2.get('/', (req, res) => {
      const nextPort = getNextPortRR(serverPort);
      previousPort = nextPort;
      proxy.web(req, res, { target: `http://localhost:${nextPort}/tryme` });
    });

    app2.get('/createflight', (req, res) => {
      const nextPort = getNextPortRR(serverPort);
      previousPort = nextPort;
      proxy.web(req, res, { target: `http://localhost:${nextPort}/createflight` });
    });

    app2.listen(3015, () => {
      console.log('La aplicación 2 está escuchando en el puerto 4000');
    });
  });
}
