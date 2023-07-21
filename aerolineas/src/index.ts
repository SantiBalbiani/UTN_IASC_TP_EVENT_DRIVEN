import express, {Express, Request, Response} from 'express';
import { createMessage } from './services/controller';

const app: Express = express();
const port = 3005;

app.get('/', (req: Request, res: Response)=>{
    res.send('Hello, this is the airlines using Express + TypeScript');
});

/* State Detail
{
    id:4343,
    seats:[{id:1,occupied:true}, {id:2,occupied:false}]    
} */

app.get('/queue', (req: Request, res: Response)=>{
    createMessage()
    res.send('Queue message created');
});

app.listen(port, ()=> {
console.log(`[Server]: I am running at http://localhost:${port}`);
});