
import client, {Channel, Connection} from 'amqplib';
import amqp from 'amqplib';
interface s_flight{
    //id: BigInteger
    when:String,
    price: Number,
    airline: String,
    origin:String,
    destination: String,
    seats: Number
}

// Función para enviar mensajes al exchange
async function sendMessageToExchange(exchange: string, message: any) {
  const connection = await amqp.connect('amqp://utn:iasc@localhost:5672');
  const channel = await connection.createChannel();

  // Declarar el exchange de tipo "fanout"
  await channel.assertExchange(exchange, 'fanout', { durable: false });

  // Publicar el mensaje en el exchange
  channel.publish(exchange, '', Buffer.from(JSON.stringify(message)));

  console.log(`Mensaje publicado en el exchange "${exchange}".`);

  await channel.close();
  await connection.close();
}

// Función para recibir mensajes del exchange
export async function receiveMessage(exchange: string, queue: string) {
  const connection = await amqp.connect('amqp://utn:iasc@localhost:5672');
  const channel = await connection.createChannel();

  // Declarar el exchange de tipo "fanout"
  await channel.assertExchange(exchange, 'fanout', { durable: false });

  // Declarar una cola exclusiva y vincularla al exchange
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
    var connectPath = "amqp://utn:iasc@localhost:5672";
    if(process.env.MQ_PROTO){
    connectPath = `${process.env.MQ_PROTO}://${process.env.MQ_USER}:${process.env.MQ_PASS}@${process.env.MQ_URL}:${process.env.MQ_PORT}`;
    }

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
    if (channel){
    channel.sendToQueue('flightsQueue', Buffer.from(JSON.stringify({ unVuelo: 'Clase A' })))}
}


async function publishMessage(message: any) {
    const connection = await client.connect('amqp://utn:iasc@localhost:5672');
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
