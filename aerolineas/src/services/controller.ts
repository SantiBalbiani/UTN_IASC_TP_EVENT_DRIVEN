
import client, { Channel, Connection } from 'amqplib';
import amqp from 'amqplib';
import retry from 'async-retry';

interface s_flight {
  //id: BigInteger
  when: String,
  price: Number,
  airline: String,
  origin: String,
  destination: String,
  seats: Number
}

//Cuando ejecuto en Docker, a veces la cola no llega a configurarse a tiempo y hay errores por todos lados.
//Implemento un connect y le paso un retry a ver si lo soluciono.
async function connectToQueueWithRetry() {
  try {
    console.log('conectando a', connectPath);
    const connection = await retry(
      async () => {
        // Intentamos conectarnos al servicio RabbitMQ
        return await client.connect(connectPath);
      },
      {
        retries: 10, 
        factor: 5, // aumento del tiempo de espera en cada reintento
        minTimeout: 1000, 
        maxTimeout: 3000, 
        onRetry: (err) => console.log(`Error al conectar a RabbitMQ. Reintentando... ${err}`),
      }
    );

    const channel = await connection.createChannel();

    // Makes the queue available to the client
    await channel.assertQueue('flightsQueue');
    console.log('conectado a la cola OK');
    return channel;
  } catch (error) {
    console.log('error', error);
    throw error; // Lanza el error para que el llamador pueda manejarlo si es necesario
  }
}

//usar esta cte si se ejecuta desde docker
/* const connectPath = `${process.env.MQ_PROTO}://${process.env.MQ_USER}:${process.env.MQ_PASS}@${process.env.MQ_URL}:${process.env.MQ_PORT}`; */
const connectPath = `${process.env.MQ_PROTO}://${process.env.MQ_USER}:${process.env.MQ_PASS}@rabbitmq:${process.env.MQ_PORT}`;
const serverHostname = 'aerolineas';
// Función para enviar mensajes al exchange
async function sendMessageToExchange(exchange: string, message: any) {
  //Usar ruta directa si se ejecuta directamente
  /* const connection = await amqp.connect('amqp://utn:iasc@localhost:5672') */

  //Esto funciona ejecutando directamente
  /*  const connection = await amqp.connect(connectPath); */
  /* const channel = await connection.createChannel(); */
  // Esto funciona ejecutando desde Docker (A veces se ejecuta esto antes que la cola esté lista)
  /* const connection = await amqp.connect(connectPath, {hostname:serverHostname});  */
  /* const channel = await connection.createChannel(); */


  const channel = await connectToQueueWithRetry();
  await channel.assertExchange(exchange, 'fanout', { durable: false });
  channel.publish(exchange, '', Buffer.from(JSON.stringify(message)));

  console.log(`Mensaje publicado en el exchange "${exchange}".`);
  //Para implementar el retry cierro el connection desde channel y no desde connection
  await channel.connection.close();
  await channel.close();

}

// Función para recibir mensajes del exchange
export async function receiveMessage(exchange: string, queue: string) {
  /* const connection = await amqp.connect('amqp://utn:iasc@localhost:5672'); */
  const connection = await amqp.connect(connectPath);
  const channel = await connection.createChannel();
  await channel.assertExchange(exchange, 'fanout', { durable: false });
  const { queue: queueName } = await channel.assertQueue('', { exclusive: true });
  await channel.bindQueue(queueName, exchange, '');

  console.log(`Esperando mensajes en la cola "${queueName}"...`);

  // Suscribirse a la cola y recibir mensajes
  return new Promise((resolve, reject) => {
    channel.consume(queueName, (message) => {
      if (message) {
        const messageValue = message.content.toString();
        console.log(`Worker ${process.pid} received message: ${messageValue}`);
        resolve(messageValue);
      }
    }, { noAck: true });
  });
}




async function connectToQueue() {
  try {
    //const connectPathDirectNoDocker = "amqp://utn:iasc@localhost:5672";
    console.log('conectando a', connectPath);
    const connection: Connection = await client.connect(connectPath)

    // Create a channel
    const channel: Channel = await connection.createChannel()
    // Makes the queue available to the client
    await channel.assertQueue('flightsQueue')
    console.log('conectado a la cola OK');
    return channel;
  } catch (error) {
    console.log('error', error);
  }
}

export async function createMessage() {
  const channel = await connectToQueue();
  if (channel) {
    channel.sendToQueue('flightsQueue', Buffer.from(JSON.stringify({ unVuelo: 'Clase A' })))
  }
}


async function publishMessage(message: any) {
  // const connection = await client.connect('amqp://utn:iasc@localhost:5672');
  const connection = await client.connect(connectPath);
  const channel = await connection.createChannel();

  const exchangeName = 'broadcast_exchange';
  //const message = '¡Este es un mensaje de broadcast!';

  // Publicar el mensaje en el exchange
  channel.publish(exchangeName, '', Buffer.from("message viteh"));

  console.log(`Mensaje publicado en el exchange "${exchangeName}".`);
}


export async function createFlightOffer(flight: s_flight) {
  const exchangeName = 'broadcast_exchange';

  await sendMessageToExchange(exchangeName, JSON.stringify(flight));

}
