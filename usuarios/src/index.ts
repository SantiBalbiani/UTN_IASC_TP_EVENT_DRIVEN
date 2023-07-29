import os from 'os';
import express from 'express';
import httpProxy from 'http-proxy';
import cluster from 'cluster';
import { Worker } from 'cluster';
import { receiveMessage1, createMessage, createFlightOffer, connectToQueue, connectAndGestChannel, sendMessageToExchange } from './services/controller';
import { removeDuplicates, deserializeMessage, findWorkerByPID,  delay, handleInitialPortsLoad, handleInitialWorkersLoad, handleInitialState, deserializeArray } from './services/helper';
import { parse } from 'url';
import client, { Channel, Connection } from 'amqplib';
import { send } from 'process';

//==========GLOBAL Variables for the whole instance=================
//const numCPUs = os.cpus().length; 
const numCPUs = 3;
let workers: Worker[] = [];
let workersGlobal: Record<number, Worker> = {};
let workersPorts: { workerPID: number; port: number }[] = [];
let previousPort = 3001;

//==================================================================

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
  let nextPort = (index === workersOnlyPorts.length - 1) ? 3000 : workersOnlyPorts[index + 1];
  console.log('puerto determinado');
  console.log(nextPort);

  return nextPort;
}

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);
  let workersData: string[] = [];
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

   cluster.on('online', (worker) => {
    
  }); 

  cluster.on('exit', (worker, code, signal) => {
    
    //quitar el elemento fallido: workersData (Este es un json string).

    //Obtengo el worker fallido
    let workersDataSerialized = workersData.map(val => JSON.parse(val));
    let failedWorker = workersDataSerialized.filter(val => val.workerPID == worker.process.pid)[0];

    //Remuevo el worker Fallido de WorkersData
    let workersDataFiletered = workersDataSerialized.filter( val => val.workerPID !== failedWorker.workerPID );
    
    
    console.log(`worker ${worker.process.pid} died in port ${failedWorker.port} with code ${code} and signal ${signal} `);
    const newWorker = cluster.fork({ PORT: failedWorker.port, INIT: true });
    
    //newWorker.send(workerdsPIDandPorts);

    if (newWorker.process.pid) {
      console.log(`worker ${newWorker.process.pid} spawned in port ${failedWorker.port}`);
      const newWorkerData = { workerPID: newWorker.process.pid, port: failedWorker.port };
      workersDataFiletered.push(newWorkerData);      
      workersDataFiletered.sort((a, b) => a.port - b.port);
      workersData = workersDataFiletered.map( val => JSON.stringify(val));
      
      console.log('new Workers/Port list with the new worker');
      console.log(workersData);

      const message = {
        type: 'WorkersPorts',
        data: workersData,
      };
      for (const id in cluster.workers) {
        cluster.workers[id]?.send(message);
      }
      
    }
  });

} else {
  //================Global Variables for Worker=======================
  workersPorts = [];
  let theState: any[] = [];
  let channel: Channel | null = null;
  let ch_reqStateSignal: Channel | null = null;
  let ch_resStateSignal: Channel | null = null;
  const proxy = httpProxy.createProxyServer({});
  const serverPort: string = process.env.PORT || '3000';
  const connectPath = `${process.env.MQ_PROTO}://${process.env.MQ_USER}:${process.env.MQ_PASS}@rabbitmq:${process.env.MQ_PORT}`;
  const queueStateUpd = `state_upd_queue_${process.pid}_${new Date().toString().slice(16,-35)}`;
  const queueInitStateReq = `state_init_req_queue_${process.pid}_${new Date().toString().slice(16,-35)}`;
  const queueInitStateRes = `state_init_res_queue_${process.pid}_${new Date().toString().slice(16,-35)}`;
  const exchangeStateUpd = 'vuelos_state_upd_broadcast';
  const exchangeRequestStateSignal = 'req_state_signal';
  const exchangeResponseState = 'res_state';
  //==================================================================

  process.on('exit', () => {
    if (channel) {
      console.log('cierro el canal del worker que murió');
      channel.close();
      ch_reqStateSignal?.close();
      ch_resStateSignal?.close();
    }
  });

  function formatStringToSON(str: string) { const regex = /(?<!\\)"/g; return JSON.parse(str.replace(regex, '').replace(/\\"/g, '"').replace(/\\"/g, '"'));}

//removeCharAtReverseIndex(removeCharAtIndex(ELSTRING,1),1)
  async function receiveInitialStateResponse(exchange: string, queue: string){
    ch_resStateSignal = await connectAndGestChannel(ch_reqStateSignal);
    await ch_resStateSignal.assertExchange(exchange, 'fanout', { durable: false });
    const { queue: queueName } = await ch_resStateSignal.assertQueue(queue, { exclusive: false });
    await ch_resStateSignal.bindQueue(queue, exchange, '');

    console.log(`Worker ${process.pid} waiting for state updates in queue "${queueName}"...`);

    // Me bindeo a la cola y recibo mensajes
    ch_resStateSignal.consume(queueName, (message: any) => {
      if (message) {
        
        const messageValue = message.content.toString();
        const deserializedMessage = formatStringToSON(messageValue);        
        console.log('Recibí el estado inicial:');
        console.log(deserializedMessage);
        if( messageValue && theState.length < 1){
          theState = deserializedMessage;
          process.env.INIT = undefined;
          console.log(`Soy el PID ${process.pid} y mi estado se actualizó`);
          console.log(theState);
        }{
          console.log('O el mensaje es vacío o ya tenía estado');
        }

      }
    }, { noAck: true });
  }

  async function receiveInitialStateRequestSignal(exchange: string, queue: string){
    ch_reqStateSignal = await connectAndGestChannel(ch_reqStateSignal);
    await ch_reqStateSignal.assertExchange(exchange, 'fanout', { durable: false });
    const { queue: queueName } = await ch_reqStateSignal.assertQueue(queue, { exclusive: false });
    await ch_reqStateSignal.bindQueue(queue, exchange, '');

    console.log(`Worker ${process.pid} waiting for state updates in queue "${queueName}"...`);

    // Me bindeo a la cola y recibo mensajes
    ch_reqStateSignal.consume(queueName, (message: any) => {
      if (message) {
        const messageValue = message.content.toString();

          if(theState.length > 0){
           sendMessageToExchange(exchangeResponseState,JSON.stringify(theState), ch_resStateSignal);
        }

      }
    }, { noAck: true });
  }

  async function receiveAndSetState(exchange: string, queue: string) {

    channel = await connectAndGestChannel(channel);
    await channel.assertExchange(exchange, 'fanout', { durable: false });
    const { queue: queueName } = await channel.assertQueue(queue, { exclusive: false });
    await channel.bindQueue(queue, exchange, '');

    console.log(`Worker ${process.pid} waiting for state updates in queue "${queueName}"...`);

    // Me bindeo a la cola y recibo mensajes
    channel.consume(queueName, (message: any) => {
      if (message) {
        const messageValue = message.content.toString();
        const messageReady = deserializeMessage(messageValue);
        console.log(`Worker ${process.pid} received state update: ${messageReady}!!!`);
        theState.push(...messageReady);
      }
    }, { noAck: true });
  }

  async function handleInitialPortsLoad(process: NodeJS.Process): Promise<{ workerPID: number; port: number }[]> {
    return new Promise((resolve) => {
      process.on('message', (message: MessageWorker) => {
        switch(message.type){
        case 'WorkersPorts':
          console.log(`Neighbours received as a response from initial state recovering with type ${message.type}:`);
          console.log(message.data);
          resolve(message.data.map(val => JSON.parse(val)));
          break;
        }
      });
    });
  }

  //Si el proceso fué revivido obtengo el último estado.
  if (process.env.INIT) {

    async function init() {

      await sendMessageToExchange(exchangeRequestStateSignal,"StateRequest", ch_reqStateSignal);
      await receiveInitialStateResponse(exchangeResponseState,queueInitStateRes);

      try {
        workersPorts = await handleInitialPortsLoad(process);
      } catch (error) {
        console.error('Error mientras se maneja la carga inicial de puertos:', error);
      }
    }

    init();
  }

  receiveAndSetState(exchangeStateUpd, queueStateUpd);
  receiveInitialStateRequestSignal(exchangeRequestStateSignal, queueInitStateReq);

  //Handler de la mensajería entre workers de la misma instancia
  process.on('message', (message: MessageWorker) => {
    switch (message.type) {
      case 'WorkersPorts':
        workersPorts = message.data.map(val => JSON.parse(val));
        break;
    }
  });

  //Rutas
  const app = express();
  app.get('/', (req, res) => {
    res.writeHead(200);
    res.end(`Hello world!\n This is the root! I am the pid ${process.pid}`);
  });

  app.get('/tryme', (req, res) => {
    res.writeHead(200);
    res.end(`Try me! Hello world!\n I am the pid ${process.pid} listening at port ${process.env.PORT}`);
  });

  app.get('/createflight', (req, res) => {
    console.log('hasta acá llegué');
    let flightMock = { when: "20230909", price: 43.5, airline: "Aerolineas", origin: "Buenos Aires", destination: "Miami", seats: 23 }
    createFlightOffer(flightMock, channel);
    res.send(`Flight Created by ${process.pid} in port: ${process.env.PORT}`);
  });

  app.get('/getstate', (req, res) => {

    if (theState) {
      console.log('the state');
      console.log(theState);
      res.status(200).send(`<div> <div> ${theState} </div> </br>  Flight Created by PID: ${process.pid} in port: ${process.env.PORT}</div>`)
    } else {
      res.send('No state yet');
    }
  });

  app.get('/createmessagequeue', (req, res) => {
    console.log('a punto de llamar a createMessage');
    createMessage()
    res.send('Queue message created');
  });

  //=======TEST_ROUTES===================================

  app.get('/isalive/:pid', (req, res) => {
    const pid = parseInt(req.params.pid);
    const worker = workersPorts.filter(workerData => workerData.workerPID == pid)[0];
    if (worker) {
      const answer = `Yes, PID ${pid} it's alive running on port ${worker.port}`
      res.status(200).send(answer);
    } else {
      const answer = `No, PID ${pid} is NOT alive.`;
      res.status(404).send(answer);
    }
  })

  app.get('/getallpids', (req, res) => {
    //const pids = workersPorts.map(workerData => workerData.workerPID).toString();
    const resp = `<div> <div> Workers PIDs and its Ports:  </br> ${JSON.stringify(workersPorts)} </div> <div> The State is: </br> ${theState}  </div> </div> `
    res.status(200).send(resp);
  })

  //=====================================================

  //Proxy Server
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
