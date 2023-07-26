
//La uso para el proxy, que cuando lo usas duplica los requests.
export function removeDuplicates(path: string): string {
  const parts = path.split('/').filter(part => part !== '');
  return '/' + parts.join('/');
}

//Solo la uso para hacer pruebas de asincronismo
async function delay(time: number) {
  return new Promise(resolve => setTimeout(resolve, time));
} 