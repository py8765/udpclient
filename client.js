var dgram = require('dgram');
var client = dgram.createSocket("udp4");
var protocol = require('pomelo-protocol');
var Package = protocol.Package;
var Message = protocol.Message;
var reqId = 0;
var nextHeartbeatTimeout = 0;
var gapThreshold = 100;
var heartbeatInterval = 3000;
var heartbeatTimeout = 6000;
var heartbeatTimeoutId = null;
var handshakeCallback = null;
var heartbeatId = null;
var callbacks = {};

var host = 'localhost';
var port = 3010;

var handshakeBuffer = {
 'sys': {
    type: 'udp-client',
    version: '0.0.1',
    rsa: {}
  },
'user': {
  }
};

var heartbeatData = Package.encode(Package.TYPE_HEARTBEAT);
var handshakeAckData = Package.encode(Package.TYPE_HANDSHAKE_ACK);
var handshakeData = Package.encode(Package.TYPE_HANDSHAKE, protocol.strencode(JSON.stringify(handshakeBuffer)));

var init = function(ip, pt, cb) {
  host = ip;
  port = pt;
  sendHandshake(cb);
};

var send = function(data, cb) {
  client.send(data, 0, data.length, port, host, function(err, bytes) {
    if(!!err) {
      console.error('udp client send message with error: %j', err.stack);
    }
    if(!!cb) {
      process.nextTick(cb);
    }
  });
};

var sendHandshake = function(cb) {
  send(handshakeData);
  handshakeCallback = cb;
};

var decode = function(data) {
  var msg = Message.decode(data);
  msg.body = JSON.parse(protocol.strdecode(msg.body));
  return msg;
};

var onData = function(data) {
  var msg = decode(data);
  processMessage(msg);
};

var processMessage = function(msg) {
  if(!msg.id) {
    client.emit(msg.route, msg.body);
    return;
  }
  var cb = callbacks[msg.id];
  delete callbacks[msg.id];
  cb(msg.body);
  return;
};

var onKick = function(data) {
  data = JSON.parse(protocol.strdecode(data));
  console.log('receive kick data: %j', data);
};

var sendMessage = function(reqId, route, msg) {
  msg = protocol.strencode(JSON.stringify(msg));
  msg = Message.encode(reqId, Message.TYPE_REQUEST, 0, route, msg);
  var packet = Package.encode(Package.TYPE_DATA, msg);
  send(packet);
};

var handshake = function(data) {
  data = JSON.parse(protocol.strdecode(data));
  console.log('receive handshake data: %j', data);
  send(handshakeAckData, handshakeCallback);
};

var request = function(route, message, cb) {
  reqId++;
  callbacks[reqId] = cb;
  sendMessage(reqId, route, message);
};

var heartbeat = function(data) {
  console.log('receive heartbeat');
  if(!heartbeatInterval) {
    return;
  }
  if(heartbeatTimeoutId) {
    clearTimeout(heartbeatTimeoutId);
    heartbeatTimeoutId = null;
  }
  if(heartbeatId) {
    return;
  }
  heartbeatId = setTimeout(function() {
    heartbeatId = null;
    console.log('send heartbeat message');
    send(heartbeatData);
    nextHeartbeatTimeout = Date.now() + heartbeatTimeout;
    heartbeatTimeoutId = setTimeout(heartbeatTimeoutCb, heartbeatTimeout);
  }, heartbeatInterval);
};

var heartbeatTimeoutCb = function() {
  var gap = nextHeartbeatTimeout - Date.now();
  if(gap > gapThreshold) {
    heartbeatTimeoutId = setTimeout(heartbeatTimeoutCb, gap);
  } else {
    console.error('server heartbeat timeout');
  }
};

var processPackage = function(msgs) {
  if(Array.isArray(msgs)) {
    for(var i=0; i<msgs.length; i++) {
      var msg = msgs[i];
      handlers[msg.type](msg.body);
    }
  } else {
    handlers[msgs.type](msgs.body);
  }
};

handlers = {};
handlers[Package.TYPE_HANDSHAKE] = handshake;
handlers[Package.TYPE_HEARTBEAT] = heartbeat;
handlers[Package.TYPE_DATA] = onData;
handlers[Package.TYPE_KICK] = onKick;

client.on("message", function (msg, rinfo) {
  processPackage(Package.decode(msg));
});

init('localhost', 3010, function() {
  request('connector.entryHandler.entry', {username:'py', rid:'1', route:'connector.entryHandler.entry'}, function(data) {
    console.log('receive enter callback data: %j', data);
    request('chat.chatHandler.send', {content: 'hello world', target: '*', route: 'onChat'}, function(data) {
      console.log('receive send callback data: %j', data);
    });
  });

  client.on('onAdd', function(msg) {
    console.log('onAdd receive message: %j', msg);
  });

  client.on('onLeave', function(msg) {
    console.log('onLeave receive message: %j', msg);
  });

  client.on('onChat', function(msg) {
    console.log('onChat receive message: %j', msg);
  });
});