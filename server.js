const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir los archivos estáticos de la carpeta actual (index.html, game.js)
app.use(express.static(__dirname));

// Almacenar el estado de los jugadores conectados
const players = {};

io.on('connection', (socket) => {
    console.log('Un jugador se ha conectado:', socket.id);

    // Añadir al nuevo jugador al registro
    players[socket.id] = {
        id: socket.id,
        x: 0,
        y: 10,
        z: 0,
        rotation: 0
    };

    // Enviar todos los jugadores actuales al jugador que acaba de entrar
    socket.emit('currentPlayers', players);

    // Avisar a todos los DEMÁS jugadores que alguien ha entrado
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // Cuando el jugador se mueve, actualizamos y reenviamos
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].rotation = movementData.rotation;
            
            // Reenviar a los demás jugadores
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // Cuando un jugador se desconecta
    socket.on('disconnect', () => {
        console.log('Un jugador se desconectó:', socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`🚀 SERVIDOR MULTIJUGADOR INICIADO 🚀`);
    console.log(`Entra a http://localhost:${PORT} para jugar`);
    console.log(`=========================================\n`);
});
