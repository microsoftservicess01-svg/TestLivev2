require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const nsfw = require('nsfwjs');
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
const ADMIN_KEY = process.env.ADMIN_KEY || 'adminkey';

app.use(cors());
app.use(express.json({limit:'6mb'}));

const users = {}; // id -> {id, passwordHash, displayName}
const sockets = {}; // socketId -> userId
let currentBroadcaster = null;
const warnings = {};
const banned = {};

let nsfwModel = null;
(async ()=>{
  try{
    nsfwModel = await nsfw.load();
    console.log('nsfw model loaded');
  }catch(e){ console.error('nsfw load err', e); }
})();

app.use(express.static(path.join(__dirname,'frontend')));

app.post('/api/signup', async (req,res)=>{
  const { accessKey, password, displayName } = req.body;
  if (!accessKey || accessKey !== ADMIN_KEY) return res.status(403).json({error:'invalid access key'});
  if (!password || password.length<4) return res.status(400).json({error:'password too short'});
  const id = 'user-'+uuidv4().slice(0,8);
  const hash = await bcrypt.hash(password,10);
  users[id] = { id, passwordHash:hash, displayName: displayName || id, createdAt:Date.now() };
  const token = jwt.sign({id}, JWT_SECRET, {expiresIn:'7d'});
  res.json({ id, token });
});

app.post('/api/login', async (req,res)=>{
  const { id, password } = req.body;
  if (!id || !password) return res.status(400).json({error:'missing'});
  const u = users[id];
  if (!u) return res.status(404).json({error:'not found'});
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return res.status(401).json({error:'bad creds'});
  const token = jwt.sign({id}, JWT_SECRET, {expiresIn:'7d'});
  res.json({ id, token });
});

app.get('/api/users', (req,res)=>{
  res.json(Object.values(users).map(u=>({id:u.id,displayName:u.displayName})));
});

app.post('/api/moderate-frame', async (req,res)=>{
  try{
    const auth = req.headers.authorization?.split(' ')[1];
    if (!auth) return res.status(401).json({error:'no auth'});
    const { id } = jwt.verify(auth, JWT_SECRET);
    if (banned[id]) return res.json({banned:true});
    const { frame } = req.body;
    if (!frame || !nsfwModel) return res.json({ok:false, modelLoaded:!!nsfwModel});
    const img = Buffer.from(frame,'base64');
    const tensor = tf.node.decodeImage(img,3);
    const preds = await nsfwModel.classify(tensor);
    tensor.dispose();
    const risky = preds.some(p=> (['Porn','Hentai','Sexy'].includes(p.className) && p.probability>0.6));
    if (risky){
      warnings[id] = (warnings[id]||0)+1;
      const count = warnings[id];
      const sockId = Object.keys(sockets).find(sid=>sockets[sid]===id);
      if (sockId) io.to(sockId).emit('warning',{id,count});
      if (count>=3){
        banned[id]=true;
        if (currentBroadcaster===id){ currentBroadcaster=null; io.to('public').emit('stop-live',{id}); }
      }
    }
    res.json({ok:true,risky});
  }catch(e){ console.error(e); res.status(500).json({error:'moderation failed'}); }
});

io.on('connection', socket=>{
  socket.on('auth', token=>{
    try{
      const pl = jwt.verify(token, JWT_SECRET);
      sockets[socket.id]=pl.id;
      socket.join('public');
      socket.emit('auth-ok',{id:pl.id,displayName: users[pl.id]?.displayName});
      if (currentBroadcaster) socket.emit('live-started',{id:currentBroadcaster});
    }catch(e){ socket.emit('auth-fail'); }
  });
  socket.on('public-message', txt=>{
    const from = sockets[socket.id]||'anon';
    io.to('public').emit('public-message',{from,text:txt});
  });
  socket.on('go-live', ({id})=>{
    if (banned[id]) { socket.emit('banned'); return; }
    currentBroadcaster = id;
    io.to('public').emit('live-started',{id});
  });
  socket.on('stop-live', ()=>{ currentBroadcaster=null; io.to('public').emit('live-stopped'); });
  socket.on('public-signal', data=>{ socket.to('public').emit('public-signal', { from: sockets[socket.id]||'anon', ...data }); });
  socket.on('private-signal', data=>{ // forward to specific socket if exists
    const target = Object.keys(sockets).find(sid=>sockets[sid]===data.to);
    if (target) io.to(target).emit('private-signal',{from: sockets[socket.id]||'anon', payload: data.payload});
  });
  socket.on('disconnect', ()=>{ delete sockets[socket.id]; });
});

server.listen(PORT, ()=> console.log('listening', PORT));
