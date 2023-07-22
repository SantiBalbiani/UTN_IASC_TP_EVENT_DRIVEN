import express, {Express, Request, Response} from 'express';
import { setupExchangeStateQueue  } from './broadcastQueue';

const app = express();
const port = 15673;

app.get('/', (req: Request, res: Response)=>{
    res.send('Hello, this is the State Broadcast Service');
});

app.get('/initialSetup', (req: Request, res: Response)=>{
    setupExchangeStateQueue().then( something => {
        res.status(200).send('Broadcast Queue Setup completed')
     }).catch(error => {
        console.error
        res.status(500).send(JSON.stringify(error));
    });
})

app.listen(port, ()=> {
    console.log(`[Server]: I am running at http://localhost:${port}`);
    });