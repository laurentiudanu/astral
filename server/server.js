var Server = require('ws').Server;
var port = process.env.PORT || 33334;
var ws = new Server({port: port}); // websocket

var fs = require('fs'); // filesystem

const {
  performance
} = require('perf_hooks'); // performance

var chokidar = require('chokidar'); // file watcher
var watcher = chokidar.watch("../client/assets", {ignored: /.meta/, ignoreInitial: true, persistent: true});

var objectCount = 0;
var playerCount = 0;
var players = [];			// connected players
var objects = [];			// game objects
var topics = [];			// send queue topics
var sendQueue = [];			// send queue (unused see topics)
var sendCount = 0;			// send count
var receiveQueue = [];		// receive queue

var metaBlacklist = [ // don't make .meta files for these filetypes
	"meta",
	"license",
	"prefab",
	"scene",
	"atlas"
];

var clientPath = "../client/";
var assetPath = "../client/assets";

/*==================
	STARTUP
==================*/

init();

function init() {
	createTopic("zone1");
	createTopic("serverglobal");
	setInterval(serverLoop, 1000 / 30);
}

/*==================
	EDITOR STUFF
==================*/

var fileList = [];
var addedFileName;
var addedFilePath;
var unlinkedFileInfo;
var addedFileInfo;
var unlinkedFiles = [];

watcher.on("add", function(path) {
	console.log("file added " + path);
	setTimeout(function() {
		var addedInfo = getFileInfo(path);
		var unlinkedInfo = unlinkedFiles[addedInfo.name];
		if (unlinkedInfo && addedInfo.name == unlinkedInfo.name) {
			console.log("should move ", unlinkedInfo.name + ".meta", "to", addedInfo.dir);
			fs.renameSync(unlinkedInfo.path + ".meta", addedInfo.path + ".meta");
			delete unlinkedFiles[addedInfo.name];
			console.log("unlinked remaining", unlinkedFiles);
		}
		else {
			unlinkedFiles = [];
			createMetaFile(path);
		}
	}, 300);
});

watcher.on("change", function(path) {
	console.log("file changed " + path);
});

watcher.on("unlink", function(path) {
	console.log("file unlinked " + path);
	var info = getFileInfo(path);
	if (fs.existsSync(info.path + ".meta")) {
		unlinkedFiles[info.name] = info;
	}
});

function getUniquePath(fi) {
	var c = 1;
	var finalPath = fi.path;
	// if the path already exists make it unique
	while(fs.existsSync(finalPath)) {
		finalPath = fi.dir + "/" + fi.nameNoExt + c;
		if (fi.ext) finalPath += "." + fi.ext;
		c++;
	}
	return finalPath;
}

function createFile(path) {
	// var c = 1;
	// var finalPath = path;
	// var fi = getFileInfo(path);

	// // if the path already exists make it unique
	// while(fs.existsSync(finalPath)) {
	// 	finalPath = fi.dir + "/" + fi.nameNoExt + c;
	// 	if (fi.ext) finalPath += "." + fi.ext;
	// 	c++;
	// }

	var fi = getFileInfo(path);
	var finalPath = getUniquePath(fi);

	// TODO: if its a json file we need to add some content ([]) to make it valid json
	var content = "";
	switch (fi.ext) {
		case "scene":
		case "prefab":
		case "atlas":
			content = "[]";
			break;
	}

	fs.writeFile(finalPath, content, function(err) {
		if (err) {
			queueSend("zone1", "*createfileresult,");
		}
		else {
			queueSend("zone1", "*createfileresult," + finalPath);
		}
	});
}

function deleteFile(path) {
	if (fs.existsSync(path)) {
		fs.unlink(path, function(err) {
			if (err) {
				queueSend("zone1", "*deletefileresult,");
			}
			else {
				queueSend("zone1", "*deletefileresult," + path);
			}
		});
	}
	else {
		// the file doesnt exist
		queueSend("zone1", "*deletefileresult,");
	}
}

function renameFile(src, dst) {
	fs.rename(src, dst, function(err) {
		if (err) {
			queueSend("zone1", "*renamefileresult,");
		}
		else {
			queueSend("zone1", "*renamefileresult," + dst);
		}
	});
}

function saveScene(spl) {
	var path = spl[1];
	var jsonParts = [];
	for (var i = 2; i < spl.length; i++) {
		jsonParts.push(spl[i]);
	}
	var jsonString = jsonParts.join(",");
	//console.log(jsonString);
	// jsonString = "\"" + jsonString + "\"";
	// // TODO: we have to parse twice because we might be stringifying twice...
	// var jsonObject = JSON.parse(JSON.parse(jsonString));
	// fs.writeFileSync(path, JSON.stringify(jsonObject, null, 4));
	jsonString = JSON.stringify(JSON.parse(jsonString), null, 4);
	fs.writeFileSync(clientPath + path, jsonString);
}

function copyFile(spl) {
	var srcpath = spl[1];
	var fi = getFileInfo(srcpath);
	var dstpath = getUniquePath(fi);
	fs.copyFile(srcpath, dstpath, (err) => {
	    if (err) throw err;
	    console.log("copied file:", fi.name + "->" + dstpath);
	});
}

function makePrefab(spl) {
	//console.log("MAKEPREFAB", spl);
	var name = spl[1];
	var jsonParts = [];
	for (var i = 2; i < spl.length; i++) {
		jsonParts.push(spl[i]);
	}
	var jsonString = jsonParts.join(",");
	console.log(jsonString);

	//console.log(JSON.parse(jsonString));
	//jsonString = "\"" + jsonString + "\"";
	//var jsonObject = JSON.parse(JSON.parse(jsonString));
	//fs.writeFileSync("../client/assets/test.prefab", JSON.stringify(jsonObject, null, 4));
	jsonString = JSON.stringify(JSON.parse(jsonString), null, 4);
	fs.writeFileSync("../client/assets/" + name + ".prefab", jsonString);
}

console.log(getMetas("../client/assets"));

function createMetaFile(path) {
	console.log("WARNING: .meta function disabled for now");
	return;
	// var pathWithoutExt = path.split('.').slice(0, -1).join('.');
	// var metaFilePath = pathWithoutExt + ".meta";
	var metaFilePath = path + ".meta";
	var content = {};
	content.id = performance.now().toString().replace(".", "");
	if (!fs.existsSync(metaFilePath)) {
		console.log("creating meta file for " + path);
		fs.writeFile(metaFilePath, JSON.stringify(content), function(err) {
			if (err) {
				console.log("ERROR: " + err);
			}
		});
	}
}

function getMetas(dir) {
	fs.readdirSync(dir).filter(function (file) {
		const path = dir+'/'+file;
		if (fs.statSync(path).isDirectory()) {
			getMetas(path);
		}
		else {
			const fi = getFileInfo(path);

			// if (!file.includes(".meta") && 
			// 	!file.includes(".prefab") && 
			// 	!file.includes(".scene") && 
			// 	!file.includes(".atlas")
			// ) {
			// 	// we have a raw resource, now check if it has a matching .meta file and if not 
			//	//	create it
			// 	createMetaFile(path);
			// 	fileList.push(file);
			// }

			if (metaBlacklist.includes(fi.ext) == false) {
				// we have a raw resource, now check if it has a matching .meta file and if not
				//	create it
				createMetaFile(path);
				fileList.push(file);
			}
		}
	});
	return fileList;
}

function getFiles(path) {
	return fs.readdirSync(path).filter(function (file) {
		if (!file.includes(".meta")) {
			return fs.statSync(path+'/'+file).isFile();	
		}
	});
	// https://stackoverflow.com/questions/18112204/get-all-directories-within-directory-nodejs/24594123
}

function getDirectories(path) {
	return fs.readdirSync(path).filter(function (file) {
		return fs.statSync(path+'/'+file).isDirectory();
	});
	// https://stackoverflow.com/questions/18112204/get-all-directories-within-directory-nodejs/24594123
}

/*==================
	NETCODE
==================*/

ws.on('connection', function(client, req) {
	// client connected, add a player for this client
	var cid = req.headers['sec-websocket-key']; // unique client id from the socket
	var player = addPlayer(cid, client);
	var name = player.name;

	// handle messages from client
	client.on('message', function(rawmsg){
		// look up the player who sent this message using the unique client id from the socket
		var cid = req.headers['sec-websocket-key'];
		var player = players[cid];
		// receive the message
		//var msg = rawmsg.slice(1, -1); // trims off the quotes
		console.log("-> " + name + " :: " + rawmsg);
		var msg = rawmsg;
		queueReceive(player, msg);
	});

	// handle client disconnect
	client.on('close', function() {
		// look up the player who disconnected using the unique client id from the socket
		var cid = req.headers['sec-websocket-key'];
		var player = players[cid];
		var oid = player.object.id;
		// remove the player and notify other players
		console.log("client disconnected :: " + player.name);
		removePlayer(player);
		queueSend("zone1", "*delete," + oid);
	});

	// // send the assets folder contents for editor mode where non-async methods are ok
	
	// var files = getFiles('../client/assets/');
	// var folders = getDirectories('../client/assets/');
	// //var final = folders.concat(['***']).concat(files);
	// var final = folders.join() + "***" + files.join();
	// console.log("FINAL", final);
	// queueSend(name, "*dirlist," + final);

	// greet the client that just connected
	queueSend(name, "*createm," + getObjectsByTopic("zone1"));
	queueSend(name, "*greet," + player.object.id + "," + name);
});

function sendNow(id, payload) {
	var player = players[id];
	var name = player.name;
	console.log("<- " + name + " :: " + payload);
	if (player) {
		if (player.client.readyState == 1) {
			player.client.send(payload);
		}
		else {
			console.log(name + " dropped");
			removePlayer(player);
		}
	}
	else {
		console.log("tried to sendNow to " + name + " but that player does not exist");
	}
}

function queueSend(topic, payload) {
	sendCount += 1;
	topics[topic].push(payload);
}

function handleSendQueue() {
	if (sendCount > 0) {
		console.log("sending " + sendCount + " message(s)");
		for (var key in objects) {
			var obj = objects[key];
			if (obj != null) {
				//console.log("sending for object " + obj.name);
				// if the object is a player, send pending messages
				if (obj.player) {
					//console.log("sending for player " + obj.player.name);
					obj.topics.forEach(function(key) {
						//console.log("sending for topic " + key);
						var topic = topics[key];
						for (var u = 0; u < topic.length; u++) {
							sendNow(obj.player.id, topic[u]);
						}
					});
				}
			}
		}
		// for (var i = 0; i < objects.length; i++) {
		// 	var obj = objects[i];

		// }
		// clear the queue
		sendCount = 0;
		//topics["zone1"] = [];
		// TODO: need to clear all channels not just zone1!
		for (var key in topics) {
			topics[key] = [];
		};
	}
}

function queueReceive(player, msg) {
	receiveQueue.push({player: player, msg: msg});
}

function handleReceiveQueue() {
	if (receiveQueue.length > 0) {
		console.log("handling " + receiveQueue.length + " client message(s)");
		receiveQueue.forEach(function(e) {
			handleMessage(e.player, e.msg);
		});
		// clear the queue
		receiveQueue = [];
	}
}

function handleMessage(player, payload) {
	console.log("handling message '" + payload + "' for " + player.name);

	var task;
	var spl = payload.split(",");
	if (spl.length == 0) {
		task = payload;
	}
	else {
		task = spl[0];
	}
	
	switch (task) {
		case "*keepalive":
			var zone = player.name;
			queueSend(zone, "*keepalive,pong!," + Date.parse(new Date().toUTCString()));
			break;
		case "*move":
			// player doesnt hold the vx and vy...its parent gameobject does...
			var obj = player.object;
			obj.vx = parseInt(spl[1]);
			obj.vy = parseInt(spl[2]);
			var zone = "zone1";
			queueSend(zone, "*move," + obj.id + "," + obj.vx + "," + obj.vy + "," + obj.x + "," + obj.y);
			break;
		case "*getdir":
			var zone = player.name;
			queueSend(zone, "*dirlist," + getDir(spl[1]));
			break;
		case "*exec":
			var exec = require('child_process').exec;
			exec("start" + ' ' + spl[1]);
			break;
		case "*createfile":
			var path = spl[1];
			createFile(path);
			break;
		case "*renamefile":
			var src = spl[1];
			var dst = spl[2];
			renameFile(src, dst);
			break;
		case "*deletefile":
			var path = spl[1];
			deleteFile(path);
			break;
		case "*savescene":
			saveScene(spl);
			break;
		case "*copyfile":
			copyFile(spl);
			break;
		case "*makeprefab":
			makePrefab(spl);
			break;
	}
}

function getDir(path) {
	path = assetPath + "/" + path;
	var files = getFiles(path);
	var folders = getDirectories(path);
	//var final = folders.concat(['***']).concat(files);
	var final = folders.join() + '***' + files.join();
	return final;
}

/*==================
	CORE
==================*/

function serverLoop() {
	var now = new Date();
	handleReceiveQueue();
	updateObjects();
	handleSendQueue();
	var elapsed = Math.abs(new Date() - now);
	//console.log("--- " + elapsed + "ms " + outcount + " events in queue");
}

function updateObjects() {
	for (var key in objects) {
		var obj = objects[key];
		if (obj != null) {
			obj.x = obj.x + (obj.vx * obj.speed);
			obj.y = obj.y + (obj.vy * obj.speed);
		}
		// TODO: as an optimization we could build a list of objects who have pending
		//	messages in the queue so that handleSendQueue() can iterate a smaller list
	}
	// for (var i = 0; i < objects.length; i++) {

	// }
}

function createTopic(name) {
	topics[name] = [];
	//ref: https://en.wikipedia.org/wiki/Publish%E2%80%93subscribe_pattern
}

function removeTopic(name) {
	delete topics[name];
}

function getObjectsByTopic(topic) {
	var topicObjects = [];
	var topicObjectsString = "";
	for (var key in objects) {
		var obj = objects[key];
		if (obj != null) {
			if (obj.topics.includes(topic) ) {
				topicObjects.push(obj);
				if (topicObjectsString != "") {topicObjectsString += ",";}
				topicObjectsString += obj.id + "," + obj.name + "," + obj.x + "," + obj.vx + "," + obj.y + "," + obj.vy;
			}
		}
	}
	// for (var i = 0; i < objects.length; i++) {
	// 	var obj = objects[i];

	// }
	return topicObjectsString;
}

function addPlayer(id, client) {
	playerCount++;
	var name = "player" + playerCount;
	console.log(name + " connected");

	// create the player and attach the client info to it
	var player = {};
	player.id = id;
	player.name = name;
	player.client = client;

	// store the player
	players[player.id] = player;

	// create a gameobject for the player
	var obj = createGameObject(name, "zone1");
	obj.player = player;
	player.object = obj;

	// create a topic for this player to receive messages
	createTopic(player.name);

	return player;
}

function removePlayer(player) {
	var name = player.name;
	var cid = player.client.id;
	var oid = player.object.id;
	removeTopic(name);
	//delete objects[oid];
	//objects = objects.splice(oid, 1);
	delete objects[oid];
	delete player.parent;
	delete player.client;
	delete players[name];
	//players = players.splice(players.indexOf(name), 1);
	player = null;
	console.log("removed object " + name);
	// ref: https://stackoverflow.com/questions/742623/deleting-objects-in-javascript
}

function createGameObject(name, sector) {
	objectCount++;

	// create the object
	var obj = {};
	obj.id = "o" + objectCount;
	obj.name = name;
	obj.x = 50;
	obj.vx = 0;
	obj.y = 50;
	obj.vy = 0;
	obj.speed = 3;
	obj.topics = [name, sector, "serverglobal"];
	objects[obj.id] = obj;

	// queue a message to notify others in this sector about the new object
	queueSend(sector, "*create," + obj.id + "," + obj.name + "," + obj.x + "," + obj.vx + "," + obj.y + "," + obj.vy);

	// return the object to the calling function so we can further manipulate it there
	console.log("created object " + obj.name + " with id " + obj.id);
	return obj;
}

/*==================
	HELPERS
==================*/

// function getFileInfo(path) {
// 	var info = {};
// 	info.path = path;
// 	info.dir = path.substring(0, path.lastIndexOf("\\"));
// 	info.name = path.split("\\").pop();
// 	//console.log(info);
// 	return info;
// }

function getFileInfo(path) {
	// gets basic info about a file path
	// TODO: this is also in server.js but paths differ by use of \\
	var info = {};
	info.path = path.replace("\\", "/");
	info.dir = path.substring(0, path.lastIndexOf("/"));
	info.name = path.split("/").pop();
	if (info.name.includes(".")) {
		info.ext = path.split(".").pop().toLowerCase();
		info.nameNoExt = info.name.split(".").slice(0, -1).join(".");
	}
	else {
		info.ext = "";
		info.nameNoExt = info.name;
	}
	console.log("got file info for " + info.name + ":", info);
	switch (info.ext) {
		case "png":
		case "jpg":
			info.type = "image";
			break;
		case "js":
			info.type = "script";
			break;
		case "atlas":
			info.type = "atlas";
			break;
		case "scene":
			info.type = "scene";
			break;
		case "prefab":
			info.type = "prefab";
			break;
		case "mp3":
		case "wav":
			info.type = "sound";
			break;
		case "json":
			info.type = "data";
			break;
	}
	return info;
}

function isObjectEmpty(obj) {
	if (Object.keys(obj).length === 0 && obj.constructor === Object) {
		return true;
	}
	else {
		return false;
	}
}

/*==================
	API
==================*/

// finally, since nodejs treats these files as commonjs modules, we should define
//	a public api for accessing the objects and variables within this file from
//	the console, cli, or debugger by attaching locals to the global object

global.game = {};
global.game.objects = objects;
global.game.players = players;
global.game.createGameObject = createGameObject;

/*==================*/

// end of file, all funcs/vars should be registered, initialize server

