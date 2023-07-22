const ColaMensajes = require('amqplib');
import {Channel, Connection} from 'amqplib';

async function setupExchangeStateQueue() {

  const connectPath = `${process.env.MQ_PROTO}://${process.env.MQ_USER}:${process.env.MQ_PASS}@${process.env.MQ_URL}:${process.env.MQ_PORT}`;
  console.log('Connecting update state queue with path: ', connectPath);

  const connection: Connection = await ColaMensajes.connect(connectPath);
  const channel: Channel = await connection.createChannel();

  const exchangeName = 'state_broadcast';
  const exchangeType = 'fanout';

  await channel.assertExchange(exchangeName, exchangeType, { durable: false });

  console.log(`Exchange "${exchangeName}" successfully created and ready.`);
}

export {setupExchangeStateQueue};

setupExchangeStateQueue().catch(console.error);