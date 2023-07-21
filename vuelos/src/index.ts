import express, {Express, Request, Response} from 'express';
import { createMessage } from './services/connect-queue';

const app: Express = express();
const port = 3002;

app.get('/', (req: Request, res: Response)=>{
    res.send('Hello, this is Express + TypeScript');
});

app.get('/queue', (req: Request, res: Response)=>{
    createMessage()
    res.send('Queue message created');
});

app.listen(port, ()=> {
console.log(`[Server]: I am running at http://localhost:${port}`);
});