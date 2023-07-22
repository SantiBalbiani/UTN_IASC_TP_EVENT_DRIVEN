
import client, {Channel, Connection} from 'amqplib';

interface s_flight{
    //id: BigInteger
    when:String,
    price: Number,
    airline: String,
    origin:String,
    destination: String,
    seats: Number
}

async function connectToQueue() {
   try {
    const connectPath = `${process.env.MQ_PROTO}://${process.env.MQ_USER}:${process.env.MQ_PASS}@${process.env.MQ_URL}:${process.env.MQ_PORT}`;
    console.log('conectando a', connectPath);
    
    const connection: Connection = await client.connect(connectPath)

    // Create a channel
    const channel: Channel = await connection.createChannel()

    // Makes the queue available to the client
    await channel.assertQueue('flightsQueue')

    return channel;
   } catch (error) {
    console.log('error', error);  
   }
}

export async function createMessage() {
    const channel = await connectToQueue();
    if (channel)
    channel.sendToQueue('flightsQueue', Buffer.from(JSON.stringify({ unVuelo: 'Clase A' })))
}


async function publishMessage(message: any) {
    const connection = await ColaMensajes.connect('amqp://localhost');
    const channel = await connection.createChannel();
  
    const exchangeName = 'broadcast_exchange';
    //const message = '¡Este es un mensaje de broadcast!';
  
    // Publicar el mensaje en el exchange
    channel.publish(exchangeName, '', Buffer.from(message));
  
    console.log(`Mensaje publicado en el exchange "${exchangeName}".`);
  }


export async function createFlightOffer(flight: s_flight) {

    publishMessage(flight);

}
