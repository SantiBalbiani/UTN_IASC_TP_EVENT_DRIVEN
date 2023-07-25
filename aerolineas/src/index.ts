import os from 'os';
import express from 'express';
import httpProxy from 'http-proxy';
import cluster from 'cluster';
import { Worker } from 'cluster';
import { receiveMessage, createMessage, createFlightOffer } from './services/controller';
import { removeDuplicates } from './services/helper';
import { parse } from 'url';
//const numCPUs = os.cpus().length; 
const numCPUs = 3;
const workers: Worker[] = [];
let workersPorts: { workerPID: number; port: number }[] = [];
let previousPort = 3001;

interface MessageWorker {
  type: string;
  data: string[];
}

function getNextPortRR(port_from_server: string) {
  const workersOnlyPorts = workersPorts.map(value => value.port);
  //let index = workersOnlyPorts.indexOf(parseInt(process.env.PORT));
  //-->Usar port_from_server hace que funcione solo corriendose en docker.
  //-->Usar previousPort hace que funcione solo corriendose directo.
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

 async function delay(time: number) {
  return new Promise(resolve => setTimeout(resolve, time));
} 

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
    console.log(`worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    //cluster.fork({ PORT: 3000 + workers.length }); // Reemplazar el worker muerto con uno nuevo reutilizando el puerto.
    let workersDataSerialized = workersData.map(val => JSON.parse(val));
    let falledWorker = workersDataSerialized.filter( val => val.workerPID == worker.process.pid);
    cluster.fork({ PORT: falledWorker[0].port });
  });
} else {
  workersPorts = [];

  let theState: any[] = [];
  const queueName = `worker_queue_${process.pid}`;
  const exchangeName = 'broadcast_exchange';
  async function receiveAndSetState(exchange: string, queue: string) {
    const message = await receiveMessage(exchange, queue);
    if (typeof message === 'string') {
      theState.push(JSON.parse(message));
    } else {
      console.error('Received message is not a string:', message);
    }
  }
  
  receiveAndSetState(exchangeName, queueName);

  process.on('message', (message: MessageWorker) => {
    switch (message.type) {
      case 'WorkersPorts':
        workersPorts = message.data.map(val => JSON.parse(val));
        console.log(`Master received result from Worker ${cluster.worker?.process.pid}: ${message.type}`);
        break;
      // Acá manejo la recepción de mensajes
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
    res.writeHead(200);
    res.end(`Try me! Hello world!\n I am the pid ${process.pid} listening at port ${process.env.PORT}`);
  });

  app.get('/createflight', (req, res) => {
    console.log('hasta acá llegué');
    let flightMock = { when: "20230909", price: 43.5, airline: "Aerolineas", origin: "Buenos Aires", destination: "Miami", seats: 23 }
    createFlightOffer(flightMock);
    res.send(`Flight Created by ${process.pid} in port: ${process.env.PORT}`);
  });

  app.get('/createmessagequeue', (req, res) => {
    console.log('a punto de llamar a createMessage');
    createMessage()
    res.send('Queue message created');
  });

  app.get('/getstate', (req, res) => {

    if(theState)
    {
      res.status(200).send(`<div> <div> ${theState} </div>   Flight Created by ${process.pid} </div>`)
    }else{
      res.send('No state yet');
    }
  });

  const proxy = httpProxy.createProxyServer({});
  const serverPort: string = process.env.PORT || '3000';

  const server = app.listen(process.env.PORT, () => {
    console.log(`Worker ${process.pid} started`);
  });
    const app2 = express();
    app2.all('*', (req, res) => {
      const nextPort = getNextPortRR(serverPort);
      previousPort = nextPort;
      const originalPath = removeDuplicates(req.path); // Obtener la ruta sin duplicados
      console.log(`1er proxy http://localhost:${nextPort}${originalPath}`);
      proxy.web(req, res, { target: `http://localhost:${nextPort}${originalPath}`, ignorePath: true }); 
    });
    const proxyPort = 3015;
    app2.listen(3015, () => {
      console.log(`El proxy Server está escuchando en el puerto ${proxyPort}`);
    });
 
 
}
