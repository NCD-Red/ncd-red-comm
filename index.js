const events = require("events");
const sp = require('serialport');
const Queue = require("promise-queue");
var i2c;
try{
	i2c = require('i2c-bus');
}catch(e){
	i2c = false;
}
module.exports = {
	hasI2C: i2c !== false,
	NcdSerial: class NcdSerial{
		constructor(port, baudRate){
			this.port = port;
			this.baudRate = baudRate;
			this._emitter = new events.EventEmitter();
			this._closing = false;
			this.tout = null;
			this.serialReconnectTime = 3000;
			this.setupSerial();
		}

		setupSerial(){
			var obj = this;
			this.serial = new sp(this.port, {
				baudRate: this.baudRate,
				autoOpen: true
			});
			this.serial.on('error', function(err) {
				obj._emitter.emit('closed');
				obj.tout = setTimeout(function() {
					obj.setupSerial();
				}, obj.serialReconnectTime);
			});
			this.serial.on('close', function() {
				if (!obj._closing) {
					obj._emitter.emit('closed');
					obj.tout = setTimeout(function() {
						obj.setupSerial();
					}, obj.serialReconnectTime);
				}
			});
			this.serial.on('open',function() {
				var olderr = "";
				if (obj.tout) { clearTimeout(obj.tout); }
				obj._emitter.emit('ready');
			});
			this.serial.on('data',function(d) {
				for (var z=0; z<d.length; z++) {
					obj._emitter.emit('data',d[z]);
				}
			});
		}
		on(a,b){ this._emitter.on(a,b); }
		close(cb){ this.serial.close(cb); }
		write(m,cb){ this.serial.write(m, cb); }
	},
	UsbI2C: class UsbI2C{
		constructor(serial){
			this.comm = serial;
			this.buff = [];
			this.queue = new Queue(1);
			this.queueCBs = {fulfill: false, reject: false};
			this.awaiting = 0;
			var wire = this;
			this.comm.on('data', function(d){
				if(wire.queueCBs.fulfill){
					wire.buff.push(d);
					var valid = wire.validate();
					if(valid === true){
						var fulfill = wire.queueCBs.fulfill;
						wire.queueCBs = {fulfill: false, reject: false};
						var payload = wire.buff;
						wire.buff = [];
						//console.log(payload);
						fulfill(payload);
					}else if(valid !== false){
						//console.log([valid]);
						wire.buff = [];
						var reject = wire.queueCBs.reject;
						wire.queueCBs = {fulfill: false, reject: false};
						reject({'I2C Error': valid});
					}else{
						//console.log('processing buffer');
					}
				}else{
					console.log('no callback');
				}
			});
		}
		readBytes(addr, reg, length){
			return this.send([addr*2, reg, 0], [addr*2+1, length]);
		}
		readByte(addr, reg){
			return this.readBytes(addr, reg, 1);
		}
		writeByte(addr, byte){
			return this.send([addr*2, byte, 0]);
		}
		writeBytes(addr, reg, bytes){
			if(bytes.constructor != Array){
				return this.send([addr*2, reg, bytes, 0]);
			}else{
				var payload = [addr*2, reg];
				payload.push.apply(payload, bytes);
				payload.push(0);
				return this.send(payload);
			}
		}
		validate(){
			if(this.buff.length == this.awaiting){
				return true;
			}
			return false;
		}
		send(...payloads){
			var wire = this,
				p;
			payloads.forEach((payload) => {
				p = this.queue.add(() => {
					return new Promise((fulfill, reject) => {
						if(payload & 1) this.awaiting = payload[payload.length-1];
						wire.comm.write(payload, (err) => {
							if(err) reject(err);
							else{
								if(!(payload & 1)){
									fulfill();
								}else{
									wire.queueCBs.reject = reject;
									wire.queueCBs.fulfill = fulfill;
								}
							}
						});
					});
				});
			});
			return p;
		}
	},
	NcdSerialI2C: class NcdSerialI2C{
		constructor(serial, bus){
			this.comm = serial;
			this.bus = bus+50;
			this.returnTo = false;
			this.buff = [];
			this.queue = new Queue(1);
			this.queueCBs = {fulfill: false, reject: false};
			var wire = this;
			this.comm.on('data', function(d){
				if(wire.queueCBs.fulfill){
					wire.buff.push(d);
					var valid = wire.validate();
					if(valid === true){
						var fulfill = wire.queueCBs.fulfill;
						wire.queueCBs = {fulfill: false, reject: false};
						var payload = wire.buff.slice(2, -1);
						wire.buff = [];
						//console.log(payload);
						fulfill(payload);
					}else if(valid !== false){
						//console.log([valid]);
						wire.buff = [];
						var reject = wire.queueCBs.reject;
						wire.queueCBs = {fulfill: false, reject: false};
						reject({'I2C Error': valid});
					}else{
						//console.log('processing buffer');
					}
				}else{
					console.log('no callback');
				}
			});
		}
		readBytes(addr, reg, length){
			return this.send([addr*2, reg, 0], [addr*2+1, length]);
		}
		readByte(addr, reg){
			return this.readBytes(addr, reg, 1);
		}
		writeByte(addr, byte){
			return this.send([addr*2, byte, 0]);
		}
		writeBytes(addr, reg, bytes){
			if(bytes.constructor != Array){
				return this.send([addr*2, reg, bytes, 0]);
			}else{
				var payload = [addr*2, reg];
				payload.push.apply(payload, bytes);
				payload.push(0);
				return this.send(payload);
			}
		}
		buildPacket(payload){
			var packet = [170, payload.length+3, 188, this.bus, payload.length-1];
			packet.push.apply(packet, payload);
			packet.push(packet.reduce((t,i) => t+i)&255);
			return Buffer.from(packet);
		}
		validate(){
			if(this.buff.length){
				var len = this.buff.length;
				if(this.buff[0] == 170){
					if(len > 3 && this.buff[1]+3 == len){
						var valid = this.buff[len-1] == ((this.buff.reduce((t,i) => t+i) - this.buff[len-1]) & 255);
						if(!valid){
							return this.buff;
						}else if(this.buff[2] == 188){
							return {'i2c error': this.buff};
						}
						return true;
					}
				}else{
					return 'bad header';
				}
			}
			return false;
		}
		send(...payloads){
			var wire = this,
				p;
			payloads.forEach((payload) => {
				p = this.queue.add(() => {
					return new Promise((fulfill, reject) => {
						wire.comm.write(this.buildPacket(payload), (err) => {
							if(err) reject(err);
							else{
								wire.queueCBs.reject = reject;
								wire.queueCBs.fulfill = fulfill;
							}
						});
					});
				});
			});
			return p;
		}
	},
	NcdI2C: class NcdI2C{
		constructor(port){
			this.port = port;
			this.queue = new Queue(1);
			this.wire = i2c.open(port, (err) => {
				if(err) console.log(err);
			});
		}
		readBytes(addr, reg, length){
			var wire = this.wire;
			if(typeof length == 'undefined'){
				length = reg;
				return this.queue.add(() => {
					return new Promise((fulfill, reject) => {
						var buff = Buffer.alloc(length);
						wire.i2cRead(addr, length, buff, (err, read, ret) => {
							if(err) reject({
								func: "readBytes",
								addr: addr  ,
								length: length,
								err: err
							});
							else fulfill(ret);
						});
					});
				});
			}else{
				return this.queue.add(() => {
					return new Promise((fulfill, reject) => {
						var buff = Buffer.alloc(length);
						wire.readI2cBlock(addr, reg, length, buff, (err, read, ret) => {
							if(err) reject(err);
							else fulfill(ret);
						});
					});
				});
			}
		}
		readByte(addr, reg){
			var wire = this.wire;
			return this.queue.add(() => {
				return new Promise((fulfill, reject) => {
					wire.readByte(addr, reg, (e,b) => {
						if(e) reject(e);
						else fulfill(b);
					});
				});
			});
		}
		writeByte(addr, byte){
			var wire = this.wire;
			return this.queue.add(() => {
				return new Promise((fulfill, reject) => {
					wire.sendByte(addr, byte, (err) => {
						if(err) reject(err);
						else fulfill();
					});
				});
			});
		}

		writeBytes(addr, reg, bytes){
			var wire = this.wire;
			if(bytes.constructor != Array){
				return this.queue.add(() => {
					return new Promise((fulfill, reject) => {
						wire.writeByte(addr, reg, bytes, (err) => {
							if(err) reject(err);
							else{
								fulfill();
							}
						});
					});
				});
			}else{
				return this.queue.add(() => {
					return new Promise((fulfill, reject) => {
						var buff = Buffer.from(bytes)
						wire.writeI2cBlock(addr, reg, bytes.length, buff, (err) => {
							if(err) reject(err);
							else fulfill();
						});
					});
				});
			}
		}
	}
}
