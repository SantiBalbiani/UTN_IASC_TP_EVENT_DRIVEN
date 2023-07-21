
import client, {Channel, Connection} from 'amqplib';

async function connect() {
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
    const channel = await connect();
    if (channel)
    channel.sendToQueue('flightsQueue', Buffer.from(JSON.stringify({ unVuelo: 'Clase A' })))
}

