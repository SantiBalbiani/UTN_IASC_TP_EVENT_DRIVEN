import os from 'os';
import express from 'express';
import httpProxy from 'http-proxy';
import cluster from 'cluster';
import { Worker } from 'cluster';
import { receiveMessage1, createMessage, createFlightOffer, connectToQueue, connectAndGestChannel, sendMessageToExchange } from './services/controller';
import { removeDuplicates, deserializeMessage, findWorkerByPID,  delay, handleInitialPortsLoad, handleInitialWorkersLoad, handleInitialState } from './services/helper';
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

function updateWorkerList() {
  if (cluster.workers) {
    workersGlobal = {} as Record<number, Worker>;
    const workerIds = Object.keys(cluster.workers).map((id) => parseInt(id)); // Convertir los IDs de string a número
    workerIds.forEach((id) => {
      if(cluster.workers){
      const worker = cluster.workers[id];
      if (worker) {
        workersGlobal[id] = worker;
      }
    }
    });
    const message = {
      type: 'WorkersUpdate',
      data: workersGlobal,
    };
    console.log('A punto de hacer un broadcast de update del estado:');
    console.log(message);
    for (const id in cluster.workers) {
      cluster.workers[id]?.send(JSON.stringify(message));
    }
  }
}

function sendMessageToWorker(workerPID: number, message: any) {
  console.log('a punto de mandar un mensaje, imprimo workersGlobal');
  console.log(workersGlobal);
  const targetWorker = workersGlobal[workerPID];
  if (targetWorker) {
    targetWorker.send(message);
  } else {
    console.log(`No se encontró el worker con PID ${workerPID}`);
  }
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
    updateWorkerList();
  }); 

  cluster.on('exit', (worker, code, signal) => {
    
    //quitar el elemento fallido: workersData (Este es un json string).

    //Obtengo el worker fallido
    let workersDataSerialized = workersData.map(val => JSON.parse(val));
    let failedWorker = workersDataSerialized.filter(val => val.workerPID == worker.process.pid)[0];

    //Remuevo el worker Fallido de WorkersData
    let workersDataFiletered = workersDataSerialized.filter( val => val.workerPID !== failedWorker.workerPID );
    workersData = workersDataFiletered.map( val => JSON.stringify(val));
    
    console.log(`worker ${worker.process.pid} died in port ${failedWorker.port} with code ${code} and signal ${signal} `);
    const newWorker = cluster.fork({ PORT: failedWorker.port, INIT: true });
    updateWorkerList();
    //newWorker.send(workerdsPIDandPorts);

    if (newWorker.process.pid) {
      console.log(`worker ${newWorker.process.pid} spawned in port ${failedWorker.port}`);
      const newWorkerData = { workerPID: newWorker.process.pid, port: failedWorker.port };
      workersData.push(JSON.stringify(newWorkerData));
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

  /*   if (cluster.workers) {
      for (const id in cluster.workers) {
        const worker = cluster.workers[id];
        worker?.on('disconnect', () => {
          //console.log(`worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
          //cluster.fork({ PORT: 3000 + workers.length }); // Reemplazar el worker muerto con uno nuevo reutilizando el puerto.
          let workersDataSerialized = workersData.map(val => JSON.parse(val));
          let falledWorker = workersDataSerialized.filter(val => val.workerPID == worker.process.pid);
          cluster.fork({ PORT: falledWorker[0].port, INIT: true });
        });
      }
    } */


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
  const queueStateUpd = `state_upd_queue_${process.pid}`;
  const queueInitStateReq = `state_init_req_queue_${process.pid}`;
  const queueInitStateRes = `state_init_res_queue_${process.pid}`;
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

  async function receiveInitialStateResponse(exchange: string, queue: string){
    ch_resStateSignal = await connectAndGestChannel(ch_reqStateSignal);
    await ch_resStateSignal.assertExchange(exchange, 'fanout', { durable: false });
    const { queue: queueName } = await ch_resStateSignal.assertQueue(queue, { exclusive: true });
    await ch_resStateSignal.bindQueue(queue, exchange, '');

    console.log(`Worker ${process.pid} waiting for state updates in queue "${queueName}"...`);

    // Me bindeo a la cola y recibo mensajes
    ch_resStateSignal.consume(queueName, (message: any) => {
      if (message) {
        const messageValue = message.content.toString();
        const messageReady = deserializeMessage(messageValue);
       if( messageValue && !theState){
          theState = messageReady;
        }

      }
    }, { noAck: true });
  }

  async function receiveInitialStateRequestSignal(exchange: string, queue: string){
    ch_reqStateSignal = await connectAndGestChannel(ch_reqStateSignal);
    await ch_reqStateSignal.assertExchange(exchange, 'fanout', { durable: false });
    const { queue: queueName } = await ch_reqStateSignal.assertQueue(queue, { exclusive: true });
    await ch_reqStateSignal.bindQueue(queue, exchange, '');

    console.log(`Worker ${process.pid} waiting for state updates in queue "${queueName}"...`);

    // Me bindeo a la cola y recibo mensajes
    ch_reqStateSignal.consume(queueName, (message: any) => {
      if (message) {
        const messageValue = message.content.toString();
        if(messageValue === 'StateRequest'){
          if(theState && theState.length > 0){
           sendMessageToExchange(exchangeResponseState,JSON.stringify(theState), ch_resStateSignal);
        }
        }

      }
    }, { noAck: true });
  }

  async function receiveAndSetState(exchange: string, queue: string) {

    channel = await connectAndGestChannel(channel);
    await channel.assertExchange(exchange, 'fanout', { durable: false });
    const { queue: queueName } = await channel.assertQueue(queue, { exclusive: true });
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

/*   async function handlePortsInit(){
    workersPorts = await handleInitialPortsLoad(process);
    console.log(`todos los vecinos:`);
    console.log(workersPorts);
  } */


  async function findNeighbour(): Promise<any> {
    return new Promise((resolve, reject) => {
      const intervalId = setInterval(() => {
        const neighbourPort = getNextPortRR(serverPort);
        if (process.env.PORT && neighbourPort === parseInt(process.env.PORT)) {
          // Si el puerto es el mismo que el actual, pasamos al siguiente.
          return;
        }
        const neighbourData = workersPorts.find(workerData => workerData.port === neighbourPort);
        if (neighbourData) {
          clearInterval(intervalId); // Detenemos el intervalo cuando encontramos el vecino.
          resolve(neighbourData);
        } else {
          // Si no se encuentra el vecino, continuamos buscando.
        }
      }, 1000); // Intervalo de búsqueda, puedes ajustarlo según tus necesidades.
    });
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
      if(theState && theState.length > 0){
        process.env.INIT = undefined;
      }

      try {
        workersPorts = await handleInitialPortsLoad(process);
        console.log('INIT, imprimo los Workers');
        workersGlobal = await handleInitialWorkersLoad(process, workers);
        //let neighbourWorker: Worker | undefined;
        console.log(`Soy el PID:${process.pid}, en el puerto ${process.env.PORT}. Obteniendo estado inicial...`);
        const neighbourData = await findNeighbour();
        console.log(`Vecino localizado: ${JSON.stringify(neighbourData)}`);
        if (neighbourData) {
          console.log(`PID del que le pediremos el estado: ${neighbourData.workerPID}`);
          const message = { type: 'StateRequest', data: process.pid };
         
          
            console.log(`Soy un nuevo Worker, tengo el PID: ${process.pid} y le voy a pedir el estado a ${neighbourData.workerPID}`);
            sendMessageToWorker(neighbourData.workerPID, JSON.stringify(message));          
            //Tendría que agregar esto a la variable global para saber a quien NO pedirle el estado.
            
        }
      } catch (error) {
        console.error('Error mientras se maneja la carga inicial de puertos:', error);
      }
    }





    init();
  }

  receiveAndSetState(exchangeStateUpd, queueStateUpd);
  receiveInitialStateRequestSignal(exchangeRequestStateSignal, queueInitStateReq);

/*   function receiveMessageFromOtherWorker(message: any): Record<number, Worker> | null {
    if (Array.isArray(message) && message.length > 0) {
      // Verifica que el mensaje sea un arreglo no vacío
      const workersMap: Record<number, Worker> = convertMessageDataToWorkersMap(message.map((idString: string) => parseInt(idString).toString()));
      return workersMap;
    } else {
      console.log("El mensaje recibido no es válido. Mensaje Recibido:");
      console.log(message);
      console.log('fin del mensaje no válido recibido.');
      return null;
    }
  } */

  function receiveMessageFromOtherWorker(message: any): Record<number, Worker> | null {
     if (Array.isArray(message.data) && message.data.length > 0) { 
      // Convertir los elementos del arreglo de string a número
      const workerIds: number[] = message.data.map((idString: string) => parseInt(idString));
      // Llamar a la función convertMessageDataToWorkersMap con el arreglo de números
      const workersMap: Record<number, Worker> = convertMessageDataToWorkersMap(workerIds);
      return workersMap;
    } else {
      console.log("El mensaje recibido no es válido. Mensaje Recibido:");
      console.log(message);
      console.log('fin del mensaje no válido recibido.');
      return null;
    }
  }

  function convertMessageDataToWorkersMap(messageData: number[]): Record<number, Worker> {
    const workersMap: Record<number, Worker> = {};
    for (const id of messageData) {
      const worker = workersGlobal[id];
      if (worker) {
        workersMap[id] = worker;
      }
    }
    return workersMap;
  }

/*  
//Previous version
function convertMessageDataToWorkersMap(messageData: string[]): Record<number, Worker> {
    const workerIds: number[] = messageData.map((idString) => parseInt(idString));
  
    const workersMap: Record<number, Worker> = {};
    for (const id of workerIds) {
      const worker = workers[id];
      if (worker) {
        workersMap[id] = worker;
      }
    }
  
    return workersMap;
  } */


  //Handler de la mensajería entre workers de la misma instancia
  process.on('message', (message: MessageWorker) => {
    switch (message.type) {
      case 'WorkersPorts':
        workersPorts = message.data.map(val => JSON.parse(val));
        console.log(`Master received result from Worker ${cluster.worker?.process.pid}: ${message.type}`);
        break;
      case 'StateRequest':
        let PIDfrom = parseInt(message.data.join());
        console.log("en remitente PID que pidió el status es", PIDfrom);
        //const targetWorker = Object.values(cluster.workers).find((worker) => worker?.process.pid === 1);
        
        if (PIDfrom) {
          console.log(`soy el worker ${process.pid} y me pidió el estado mi vecino ${PIDfrom}.`)
          const message =
          {
            type: 'StateResponse',
            data: theState
          };

          sendMessageToWorker(PIDfrom, JSON.stringify(message));
          
        } else {
          console.log('no se encontró el PID del remitente');
        }
        break;
      case 'StateResponse':
       theState = message.data;  
        console.log("Mi request de estado inicial está satisfecha. El estado es:");
        console.log(message.data);
        
        break;
      case 'WorkersUpdate':
        if(message.data){
/*           console.log('WorkersUpdate data:');
          console.log(message.data);
          console.log('End of WorkersUpdate data:'); */
          let parsedData = message.data.map( val => JSON.parse(val));

          let serializedData = receiveMessageFromOtherWorker(parsedData);
          if(serializedData){
          workersGlobal = serializedData;
          console.log('WorkersUpdate Ok');
        }
        }
        break;
      //cluster.workers[senderPID]?.send(message);
      // Acá manejo la recepción de mensajes
    }
    // Cuando el worker recibe un mensaje, mostramos el valor recibido
    // console.log(`Worker ${cluster.worker?.process.pid} received message: ${message}`);
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

/*   app.get('/deletepid/:pid', (req, res) => {
    const pidToKill = parseInt(req.params.pid);
  if (isNaN(pidToKill)) {
    res.status(400).send('El PID proporcionado no es válido.');
    return;
  }

  const targetWorker = workersPorts.some( val => val.workerPID === pidToKill);

  if (!targetWorker) {
    res.status(404).send('El PID proporcionado no corresponde a un worker activo.');
    return;
  }

  process.kill(pidToKill);
  res.status(200).send(`PID ${pidToKill} eliminado.`);
}); */

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
    res.status(200).send(JSON.stringify(workersPorts));
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
