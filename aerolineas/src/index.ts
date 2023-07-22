import express, { Express, Request, Response } from 'express';
import { createMessage, createFlightOffer } from './services/controller';

//const app = express();
const port = 3005;


//=========================================================================================================
import { Worker } from 'cluster';
const cluster = require('cluster');
const os = require('os');
const http = require('http');
const httpProxy = require('http-proxy');

interface workerStructure {
    worker: any,
    code: any,
    signal: any
}

var workers: Array<Worker> = []

      // Proxy server
      const proxy = httpProxy.createProxyServer({});

      const servers = [];

      // Get the number of workers in the cluster:
      //let numberOfWorkers = Object.keys(cluster.workers).length;
      let numberOfWorkers = workers.length;
      // Load balancer
      let workersPath = `http://localhost:${port}`;
      const balancer = httpProxy.createBalancer({
        [workersPath]: numberOfWorkers // number of workers
      });
    
      const proxyServer = http.createServer((req: Request, res: Response) => {
        balancer.proxy(proxy, req, res);
      });
    
      proxyServer.listen(8082, () => {
        console.log(`Proxy server started on port ${proxyServer.address().port}`);
      });


if (cluster.isPrimary) {
    console.log(`The PPID ${process.pid} is running.`);

    // I create a worker by every CPU to use the full capacity of the instance.
    for (let i = 0; i < os.cpus().length; i++) {
        let newWorker = cluster.fork();
        workers.push(newWorker);
        //newWorker.PostMessage('connectToQueue');
        // newWorker.PostMessage('getInitialState');
    }

    // catching exit signal
    cluster.on('exit', (workerData: workerStructure) => {
        console.log(`Worker ${workerData.worker.process.pid} exited with code ${workerData.code} and signal ${workerData.signal}.`);
        cluster.fork();
         // newWorker.PostMessage('getInitialState');
    });

    /*   cluster.on('message', (message:any) => {
        switch (message){
          case 'connectToQueue':
            break;
          case 'getInitialState':
            break;
          default: 
            break;
        }
      }); */

} else {

    const app = express();

    console.log(`Worker with PID: ${process.pid} is running.`);

    // ... Acá debería agregar la lógica de los workers, tal vez debería desacoplar acá ...

    app.get('/', (req: Request, res: Response) => {
        res.send('Hello, this is the airlines using Express + TypeScript');
    });


    //Después pasar esto a post. Toy haciendo el mock recién :')
    app.get('/createflight', (req: Request, res: Response) => {
        let flightMock = { when: "20230909", price: 43.5, airline: "Aerolineas", origin: "Buenos Aires", destination: "Miami", seats: 23 }
        createFlightOffer(flightMock);
        res.send(`Flight Created by ${process.pid}`);
    });

    app.get('/queue', (req: Request, res: Response) => {
        createMessage()
        res.send('Queue message created');
    });

    

    app.listen(port, () => {
        console.log(`[Server]: I am running at http://localhost:${port} in the PID ${process.pid}`);
    });



}






//==========================================================================================================







var airlines_state = [{
    id: 4343,
    seats: [{ id: 1, occupied: true }, { id: 2, occupied: false }]
},
{
    id: 4342,
    seats: [{ id: 1, occupied: true }, { id: 2, occupied: false }]
},
{
    id: 4343,
    seats: [{ id: 1, occupied: true }, { id: 2, occupied: false }]
}
];

