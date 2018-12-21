
/*
THIS FILE IS NOT FUNCTIONAL
*/

const comms = require('./index.js');
const serial = require('serialport');

var inputHandler;
var validDevices = [];
var device;
var commandType;

process.stdin.on('data', function (text) {
	process.stdin.pause();
	inputHandler(text);
});

function getDevices(){
	return new Promise((fulfill, reject) => {
		serial.list((err, devices) => {
			if(err){
				reject(err);
			}else{
				devices.forEach((d) => {
					if(d.manufacturer == 'FTDI') valid.push(d);
				});
				if(validDevices.length == 0) reject('No devices found');
				else fulfill();
			}
		});
	});
}

function setDevice(input){
	var i = parseInt(input);
	device = new comms.NcdSerial(validDevices[i-1].comName, 115200);
	selectCommandType();
}

function selectDevice(input){
	getDevices().then(() => {
		inputHandler = setDevice;
		validDevices.forEach((d, i) => {
			console.log("	"+(i+1)+': '+d.serialNumber);
		});
		console.log('Please select a serial device 1-'+devices.length+': ');
		process.stdin.resume();
		process.stdin.setEncoding('utf8');
	}).catch((err) => {
		console.log(err);
	});
}

function setCommandType(input){
	commandType = parseInt(input) == 1 ? 'write' : parseInt(input) == 2 ? 'read' : false;

}

function selectCommandType(){
	inputHandler = setCommandType;
	process.stdin.resume();
	process.stdin.setEncoding('utf8');
	console.log('Select Command Type: ');
	console.log('	1: write');
	console.log('	2: read');
}
