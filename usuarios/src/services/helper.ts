
//La uso para el proxy, que cuando lo usas duplica los requests.
export function removeDuplicates(path: string): string {
  const parts = path.split('/').filter(part => part !== '');
  return '/' + parts.join('/');
}

//Solo la uso para hacer pruebas de asincronismo
export async function delay(time: number) {
  return new Promise(resolve => setTimeout(resolve, time));
} 

//Lo uso para deserializar el mensaje del broadcast.
export function deserializeMessage(messageArray: string[]): object[] {
  const parsedMessages: object[] = [];
  let currentJSON = '';

  for (const char of messageArray) {
    currentJSON += char;

    try {
      const parsedObject = JSON.parse(currentJSON);
      parsedMessages.push(parsedObject);
      currentJSON = '';
    } catch (error) {
      // Si el JSON no es válido, continuamos concatenando caracteres hasta encontrar un JSON válido.
    }
  }

  return parsedMessages;
}

export function deserializeArray(message: string): any[] {
  try {
    // Parseamos el string a un array de objetos JSON
    const jsonArray = JSON.parse(message);

    // Iteramos sobre el array y parseamos cada elemento a un objeto JSON
    const deserializedArray = jsonArray.map((jsonString: string) => JSON.parse(jsonString));

    return deserializedArray;
  } catch (error) {
    console.error('Error al deserializar el array:', error);
    return [];
  }
}


//Lo necesito para cuando un worker se reinicia y necesita pedirle el estado a otro worker
import cluster, { Worker } from 'cluster';
export function findWorkerByPID(pid: number): Worker | undefined {
  const workers = cluster.workers as { [s: string]: Worker | undefined };
  return Object.values(workers).find((worker) => worker?.process.pid === pid);
}

interface MessageWorker {
  type: string;
  data: string[];
}

export async function handleInitialPortsLoad(process: NodeJS.Process): Promise<{ workerPID: number; port: number }[]> {
  return new Promise((resolve) => {
    process.on('message', (message: MessageWorker) => {
      if (message.type === 'WorkersPorts') {
        console.log(`Neighbours received as a response from initial state recovering with type ${message.type}:`);
        console.log(message.data);
        resolve(message.data.map(val => JSON.parse(val)));
      }
    });
  });
}

function convertMessageDataToWorkersMap(messageData: string[], workers: Worker[]): Record<number, Worker> {
  const workerIds: number[] = messageData.map((idString) => parseInt(idString));

  const workersMap: Record<number, Worker> = {};
  for (const id of workerIds) {
    const worker = workers[id];
    if (worker) {
      workersMap[id] = worker;
    }
  }

  return workersMap;
}



function receiveMessageFromOtherWorker(message: any, workers: Worker[]): Record<number, Worker> | null {
  if (Array.isArray(message) && message.length > 0) {
    // Verifica que el mensaje sea un arreglo no vacío
    const workersMap: Record<number, Worker> = convertMessageDataToWorkersMap(message.map((idString: string) => parseInt(idString).toString()), workers);
    return workersMap;
  } else {
    console.log("El mensaje recibido no es válido. Mensaje Recibido:");
    console.log(message);
    return null;
  }
}



export async function handleInitialWorkersLoad(process: NodeJS.Process, workers: Worker[]): Promise<Record<number, Worker>> {
  return new Promise((resolve) => {
    process.on('message', (message: MessageWorker) => {
      if (message.type === 'WorkersUpdate') {
        if(message.data){
          let dataSerialized = receiveMessageFromOtherWorker(message.data, workers);
          if(dataSerialized){
            console.log('WorkersUpdate Ok');
            resolve(dataSerialized);             
          }          
          }      
      }
    });
  });
}

   export async function handleInitialState(process: NodeJS.Process, workers: Worker[]): Promise<Record<number, Worker>> {
    return new Promise((resolve) => {
      process.on('message', (message: MessageWorker) => {
        if (message.type === 'StateResponse') {
          if(message.data){
            let dataSerialized = message.data.map(val => JSON.parse(val));
            if(dataSerialized){
              console.log('WorkersUpdate Ok');
              resolve(dataSerialized);             
            }          
            }      
        }
      });
    });
  }