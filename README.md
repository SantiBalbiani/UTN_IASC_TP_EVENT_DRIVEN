# Implementación de Arquitecturas Concurrentes - Trabajo Práctico
#### UTN - Facultad Regional Buenos Aires

### Alumno
- Santiago Balbiani

### Profesores
- Ernesto Bossi
- Sofía Audisio

### Diagrama
![URL a Diagrams.io / Excallibur Image](https://github.com/SantiBalbiani/UTN_IASC_TP_EVENT_DRIVEN/blob/master/images/container1.PNG?raw=true)

### Cómo Ejecutar el proyecto

#### 1° Levantar aplicación
```
docker-compose up --build
```
#### 2° Crear uno o varios vuelos mock:
```
localhost:3015/createflight
```
#### 3° Obtener el estado:
```
localhost:3015/getState
```
#### 4° Kill a worker
```
ps aux | grep node
kill -SIGTERM <PID_DEL_WORKER>
```

