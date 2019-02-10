"use strict";
console.log("astral.js entry point");

var ASTRAL = (function() {

	console.log("astral.js constructor");

///////////////////////////////////////
//
//	PRIVATE LOCAL VARS
//
///////////////////////////////////////

	var game = {};
	var enabled = false;
	var updateEnabled = false;
	var gameInfo = [];

	// observer pattern
	var onHandlers = [];

	// graphics stuff
	var currentScene;
	var sceneData = [];
	var layers = [];
	var images = [];
	var imgMissing;
	var atlases = [];
	var prefabs = [];
	var components = [];
	var staticObjects = [];
	var physicsObjects = [];

	// sound stuff
	var muteSound = true;

	// timing stuff
	//var lastFrameTime = Date.now();
	//var pingTime = null;
	var fps = 0;

	// controls
	var mouseX = 0;
	var mouseY = 0;
	var mouseB1 = "nothing";
	var mouseB1Old = "nothing";
	var mouseB1Handled = false;
	var mouseB2 = false;
	var moveUp = false;
	var moveDown = false;
	var moveLeft = false;
	var moveRight = false;
	var lastInput = "0,0";
	var finalInput = "0,0";
	var dragOffsetX = 0;
	var dragOffsetY = 0;

	// 
	// var objectRuntimeProps = ["on", "do"];
	// var componentRuntimeProps = [];

///////////////////////////////////////
//
//	STARTUP SHUTDOWN
//
///////////////////////////////////////


	window.onload = function() {
		ASTRAL.init();
	}

	function init() {
		console.log("astral.js init()");

		loadJson("app.json", function(val) {
			gameInfo = JSON.parse(val);
			console.log("got game info:", gameInfo);
			loadBatch(gameInfo.preload, function() {
				console.log("all modules loaded, initializing based on app.json order");
				for (var i = 0; i < gameInfo.preload.length; i++) {
					var info = gameInfo.preload[i];
					// TODO: info.name doesn't work for components
					var module;
					if (info.type == "module") {
						module = ASTRAL[info.name];
					}
					else if (info.type == "component") {
						module = ASTRAL.components[info.name];
					}
					//var module = ASTRAL[info.name];
					//console.log("INITIALIZING", info, module);
					if (module && module.init) module.init();
				}
				console.log("astral was initialized successfully");
				console.log("###################################");
				ready();
			});
		});
	}

	function ready() {
		console.log("astral.js ready()");

		imgMissing = new Image();
		imgMissing.src = "core/assets/missing.png";

		// create layers
		var gameLayer = createLayer("game", 1, drawGameLayer);

		// prevent accidental drag drop on game canvas
		gameDiv.addEventListener("dragover", function(e) {
			e.preventDefault();
		}, false);

		gameDiv.addEventListener("dragenter", function(e) {
			e.preventDefault();
		}, false);

		gameDiv.addEventListener("drop", function(e) {
			e.preventDefault();
		}, false);

		// handle mousedown
		window.addEventListener("mousedown", function(e) {
			console.log("~~ mousedown fired for button " + e.button);
			mouseB1Handled = false;
			if (e.button == 0) mouseB1 = "mousedown";
		});

		window.addEventListener("mouseup", function(e) {
			console.log("~~ mouseup fired for button " + e.button);
			if (e.button == 0) mouseB1 = "mouseup";
		});

		window.addEventListener("mousemove", function(e) {
			mouseX = e.offsetX === undefined ? e.layerX : e.offsetX;
			mouseY = e.offsetY === undefined ? e.layerY : e.offsetY;
			// TODO: instead of checking editor enabled explicitly (lack of decoupling), we could
			//	just check a game.enabled instead to eliminate the strong coupling
			if (ASTRAL.editor.enabled == false) {
				ASTRAL.do("mousemove");
			}
		});

		// handle keydown
		window.addEventListener("keydown", function(e) {
			console.log("~~ keydown fired for key " + e.key);
			switch (e.key) {
				case "a":
					moveLeft = true;
					break;
				case "d":
					moveRight = true;
					break;
				case "w":
					moveUp = true;
					break;
				case "s":
					moveDown = true;
					break;
				case "`":
					// TODO: fix tight coupling (see note in Docs)
					ASTRAL.editor.toggle();
			}
		});

		// handle keyup
		window.addEventListener("keyup", function(e) {
			console.log("~~ keyup fired for key " + e.key);
			switch (e.key) {
				case "a":
					moveLeft = false;
					break;
				case "d":
					moveRight = false;
					break;
				case "w":
					moveUp = false;
					break;
				case "s":
					moveDown = false;
					break;
			}
		});

		// try connecting to the server
		// TODO: fix tight coupling (see note in Docs)
		if (ASTRAL.bridge) {
			// TODO: put this on a button or background timer, dont halt execution or fail out when connect fails
			ASTRAL.bridge.on("connect", function(){
				console.log("connect handler fired");
				//requestAnimationFrame(gameLoop);
			});

			// try to connect now
			ASTRAL.bridge.connect();
		}

		// load the startup script that will kick things off
		loadScript(gameInfo.startup, function() {
			// TODO: we shouldn't have to explicitly do this here, we should have main.js
			//	automatically call its own init() function once it has been loaded
			ASTRAL.game.main.init();
		});

		// start the engine aka game loop
		// TODO: when editing we dont want this to start right away...
		startGameLoop();

		// fire a window resize event once to make editor resolution setting take effect 
		//	since we can't call this in editor.js due to race condition (see the TODO there)
		window.dispatchEvent(new Event('resize'));
	}

	var gameLoopInterval;

	function startGameLoop() {
		enabled = true;
		//requestAnimationFrame(gameLoop);
		gameLoopInterval = setInterval(gameLoop, 1);
		//gameLoop();
	}

	function stopGameLoop() {
		enabled = false;
		clearInterval(gameLoopInterval); // TODO: doesnt seem to work
	}

	function startUpdate() {
		updateEnabled = true;
		if (inspectorPlayPause.classList.contains("play")) {
			inspectorPlayPause.classList.add("pause");
			inspectorPlayPause.classList.remove("play");
			//inspectorPlayPause.classList.add("disabled");
			inspectorStop.classList.remove("disabled");
			if (!ASTRAL.editor.sceneSnapshot) ASTRAL.editor.sceneSnapshot = sceneDataToJson();
		}
		else {
			inspectorPlayPause.classList.add("play");
			inspectorPlayPause.classList.remove("pause");
			pauseUpdate();
		}
	}

	function pauseUpdate() {
		updateEnabled = false;
	}

	function stopUpdate() {
		updateEnabled = false;
		// TODO: tight coupling here to editor made ui...
		inspectorStop.classList.add("disabled");
		inspectorPlayPause.classList.remove("disabled");
		inspectorPlayPause.classList.remove("on");
		inspectorPlayPause.classList.add("play");
		inspectorPlayPause.classList.remove("pause");
		// TODO: this is a copy of the loadScene() code, maybe we can separate it out into a loadSceneData()
		// ASTRAL.sceneData = sceneSnapshot;
		// loadObjects(ASTRAL.sceneData);
		loadSceneData(ASTRAL.editor.sceneSnapshot);
		ASTRAL.editor.sceneSnapshot = null;
		ASTRAL.game.main.ready();
	}

	function toggleMute() {
		// TODO: tight coupling here to editor made ui...
		if (inspectorSound.className.includes("on")) {
			// mute sounds
			muteSound = false;
		}
		else {
			// unmute sounds
			muteSound = true;
		}
		console.log(muteSound);
	}

///////////////////////////////////////
//
//	CORE
//
///////////////////////////////////////

	var delta = 0;
	var last = 0;
	var step = 1000 / 60; // * 5 to simulate 5x slower loop
	var t1;
	var t2 = 0;

	function gameLoop() {
		computeFps();
		network();
		input();
		update();
		draw();
	}

	// function gameLoop(timestamp) {
	// 	computeFps();
	// 	delta += timestamp - last;
	// 	last = timestamp;
	// 	while (delta >= step) {
	// 		update(step);
	// 		delta -= step;
	// 	}
	// 	draw();
	// 	requestAnimationFrame(gameLoop);
	// }

	var fpsFrames = 0;
	var fps = 0;
	var fpsLastUpdate = Date.now();

	function computeFps() {
		// start count fps:
		fpsFrames++;
		var now = Date.now();
		var diff = now - fpsLastUpdate;
		if (diff > 1000) {
			fps = fpsFrames;
			fpsFrames = 0;
			fpsLastUpdate = Date.now();
			ASTRAL.do("fps", fps);
		}
	}

	function network() {
		// network gets called once per frame to receive and process messages from the server
		// TODO: fix tight coupling (see note in Docs)...maybe fire an ASTRAL.do("beforeinput") so other modules can hook in
		if (ASTRAL.bridge) {
			ASTRAL.bridge.handleReceiveQueue();
			//ASTRAL.bridge.handleSendQueue();
		}
	}

	function update(delta) {
		// update gets called once or more per frame to simulate the next fragment of game time
		if (updateEnabled) {
			ASTRAL.do("beforeupdate");
			// clear the static and physics objects which get computed each frame
			// staticObjects = [];
			// physicsObjects = [];
			// update the objects by incrementing their state
			for (var key in sceneData) {
				updateObject(sceneData[key]);
			}
			// // update the physics objects
			// for (var key in physicsObjects) {
			// 	updatePhysicsObject(physicsObjects[key]);
			// }
			ASTRAL.do("afterupdate");
		}
	}

	function updateObject(obj) {
		// updates the object state, this gets called every frame for every object
		if (!obj.runtime) obj.runtime = [];
		obj.runtime.movementUpdated = false;
		//var hasCollider = false;
		// fire an update for each of this object's components
		for (var i = 0; i < obj.components.length; i++) {
			var ci = obj.components[i];
			var cb = components[ci.type];
			if (cb && cb.update) cb.update(obj, ci);
			// TODO: since we are calling cb.update() and collider has that method,
			//	we should handle it there
			// if (ci.type == "collider") {
			// 	hasCollider = true;
			// }
		}
		// // detect if the object has a collider and if not, do a generic position update here
		// if (hasCollider) {
		// 	// defer updating the object's position so it can be handled in the physics stage
		// 	if (ci.static == true || ci.static == "true") {
		// 		staticObjects.push(obj);
		// 	}
		// 	if (ci.physics == true || ci.physics == "true") {
		// 		physicsObjects.push(obj);
		// 	}
		// }
		// else {
		// 	// otherwise just update its movement using its movement vector and speed
		// 	obj.x += obj.vx * obj.speed // * delta;
		// 	obj.y += obj.vy * obj.speed // * delta;
		// }
		// if the object wasn't moved by external means (collider, etc) then allow it to perform
		//	a basic move here
		if (!obj.runtime.movementUpdated) {
			obj.x += obj.vx * obj.speed // * delta;
			obj.y += obj.vy * obj.speed // * delta;
		}
		// update this object's child objects recursively
		if (obj.objects) {
			for (var key in obj.objects) {
				var childObj = obj.objects[key];
				updateObject(childObj);
			}
		}
	}

	function updateObjectInputState(obj) {
		// determines input state for the object, this gets called every frame for every object
		// reset the mouse state
		obj.isMouseOver = false;
		// detect the mouse state
		if (ASTRAL.mouseX > obj.x && ASTRAL.mouseX < obj.x + obj.width) {
			if (ASTRAL.mouseY > obj.y && ASTRAL.mouseY < obj.y + obj.height) {
				//console.log(ASTRAL.mouseY, obj.y + obj.height, obj.height);
				obj.isMouseOver = true;

				if (mouseB1 == "mousedown") {
					if (ASTRAL.editor.enabled == true) {
						if (obj == ASTRAL.editor.inspectedObject) {
							obj.isDragging = true;
							dragOffsetX = ASTRAL.mouseX - obj.x;
							dragOffsetY = ASTRAL.mouseY - obj.y;
						}
					}
				}

				if (mouseB1 == "click") {
					if (ASTRAL.editor.enabled == true) {
						obj.isDragging = false;
					}
					else {
						// TODO: maybe here we can determine if the editor is toggled on and then
						//	call something like obj.do("editorclick") and if the editor is off we
						//	can just call obj.do("click")...

						if (updateEnabled == true) {
							obj.do("click");

							// TODO: or instead of firing do() we could check for an existing onclick prop
							//	and fire that instead, but the problem is that there might be multiple
							//	components with an onclick prop so which one do we use? should we just 
							//	have a single onclick prop handled at the object level? or we can attach
							//	a custom script to the object, which would act as a component, but in this
							//	script we can implement an OnMouseClick() function which gets automatically
							//	called in any and all scripts whenever obj.do("click") is called.

							var co = findComponentByType(obj, "text");
							if (co) {
								var func = co.onclick;
								if (func) eval(func);
								// TODO: find an eval alternative
								//	https://stackoverflow.com/questions/912596/how-to-turn-a-string-into-a-javascript-function-call
							}
						}
					}
				}
			}
		}

		// after determining object-mouse state, if the object is being dragged update its position
		if (obj.isDragging == true) {
			// obj.x = ASTRAL.mouseX - obj.width/2;
			// obj.y = ASTRAL.mouseY - obj.height/2;
			obj.x = ASTRAL.mouseX - dragOffsetX;
			obj.y = ASTRAL.mouseY - dragOffsetY;
		}
	}

	function draw(delta) {
		for (var key in layers) {
			var layer = layers[key];
			if (layer.visible) {
				layer.draw();
			}
		}
	}

	function drawGameLayer() {
		var layer = layers["game"];
		var can = layer.can;
		var ctx = layer.ctx;

		// clear the canvas
		ctx.clearRect(0, 0, can.width, can.height); // alternative not recommended: can.width = can.width;
		ctx.imageSmoothingEnabled = false; // TODO: not sure why we have to call this here but it only works if called here, and this needs to be an option

		// draw the objects
		for (var key in sceneData) {
			var obj = sceneData[key];
			drawObject(obj, ctx);
		}
	}

	function drawObject(obj, ctx, parent) {
		// draw the object using its renderable components
		if (obj.components) {
			var img;
			for (var i = 0; i < obj.components.length; i++) {
				var componentInstance = obj.components[i];
				// if the component is an image or atlas, call drawImage(), otherwise call the 
				//	component's update()
				if (componentInstance.type == "image") {
					img = images[componentInstance.path];
					if (!img) img = imgMissing;
					drawImage(img, obj, ctx);
				}
				else {
					var componentBase = components[componentInstance.type];
					//if (componentBase && componentBase.update) componentBase.update(obj, ctx, componentInstance);
					if (componentBase && componentBase.draw) componentBase.draw(obj, ctx, componentInstance);
				}
			}
		}
		else {
			// the object has no components, show a missing image
			drawImage(imgMissing, obj, ctx);
		}

		// draw the editor/debug hints
		drawObjectExtras(obj, ctx);

		// call drawObject() recursively for children
		if (obj.objects) {
			for (var key in obj.objects) {
				var childObj = obj.objects[key];
				drawObject(childObj, ctx, obj);
			}
		}
	}

	var marchOffset = 0;

	function drawObjectExtras(obj, ctx) {
		// draw debug/editor hints
		// TODO: fix tight coupling (see note in Docs)
		if (ASTRAL.editor.enabled == true) {
			if (ASTRAL.editor.drawObjectOrigin == true) {
				// draw a cross for the object's position
				ctx.beginPath();
				ctx.moveTo(obj.x - 4, obj.y - 4);
				ctx.lineTo(obj.x + 4, obj.y + 4);
				ctx.moveTo(obj.x - 4, obj.y + 4);
				ctx.lineTo(obj.x + 4, obj.y - 4);
				ctx.strokeStyle = "red";
				ctx.stroke();
				ctx.closePath();
			}

			// draw the object info
			ctx.font = "12px Arial";
			var arrtext = [];
			if (ASTRAL.editor.drawObjectName == true) arrtext.push(obj.name);
			if (ASTRAL.editor.drawObjectId == true) arrtext.push(obj.id);
			if (ASTRAL.editor.drawObjectPos == true) arrtext.push(obj.x + "," + obj.y);
			if (ASTRAL.editor.drawObjectSize == true) arrtext.push(obj.width + "x" + obj.height);
			if (ASTRAL.editor.drawObjectRot == true) arrtext.push(obj.rot);
			if (ASTRAL.editor.drawParticleCount == true) {
				// TODO: this should be refactored into a getComponent() func
				for (var i = 0; i < obj.components.length; i++) {
					var c = obj.components[i];
					if (c.type == "particle" && c.runtime) {
						arrtext.push(c.runtime.particles.length);
					}
				}
			}
			ctx.fillText(arrtext.join(" - "), obj.x, obj.y - 6);

			// draw borders
			if (ASTRAL.editor.drawObjectBorders == true) {
				// save the context so we can set up a border style for this obj only
				ctx.save();
				ctx.lineWidth = 2;
				ctx.strokeStyle = "blue"; // default border color

				// if the obj is selected, always show marching ants
				if (obj == ASTRAL.editor.inspectedObject) {
					//ctx.strokeStyle = "yellow";
					marchOffset+= 0.25;
					if (marchOffset > 32) {
					    marchOffset = 0;
					}
					ctx.setLineDash([4, 2]);
					ctx.lineDashOffset = -marchOffset;
					ctx.strokeStyle = "yellow";
				}
				if (obj.isMouseOver == true) {
					ctx.strokeStyle = "white";
				}

				// finally, draw the border and restore the context
				//ctx.strokeRect(obj.x - 0.5, obj.y - 0.5, obj.width, obj.height);
				ctx.strokeRect(obj.x - 1, obj.y - 1, obj.width + 1, obj.height + 1);
				ctx.restore();

				// draw collider border which is separate from the obj border
				// TODO: this is going to cause us to iterate all components for all objects...
				// TODO: we should fire an event here (ASTRAL.do("drawobjectborders")) and handle it in collider.js
				var c = findComponentByType(obj, "collider");
				if (c) {
					ctx.strokeStyle = "red";
					ctx.strokeRect(obj.x, obj.y, c.width, c.height);
				}
			}

			// draw direction vectors
			ctx.save();
			ctx.lineWidth = 2;
			ctx.strokeStyle = "red"; // default border color

			var x1 = obj.x + obj.width/2;
			var x2 = x1 + obj.vx * (obj.width*3);
			var y1 = obj.y + obj.height/2;
			var y2 = y1 + obj.vy * (obj.height*3);
			
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
			ctx.closePath();

			ctx.restore();
		}
	}

	function drawImage(img, obj, ctx) {
		// draw the fully transformed image
		ctx.save();
		ctx.translate(obj.x + img.width / 2, obj.y + img.height / 2);
		ctx.rotate(obj.rot * Math.PI/180);
		ctx.scale(obj.scale, obj.scale);
		ctx.translate(-(obj.x + img.width / 2), -(obj.y + img.height / 2));
		ctx.drawImage(img, obj.x, obj.y);
		ctx.restore();
	}

	function findObject(query) {
		// TODO: need to search recursively
		// text.text would return the first text component on the first object named text in the scene
		for (var key in sceneData) {
			var obj = sceneData[key];
			if (obj.name == query) {
				return obj;
			}
		}
	}

	function findComponentByType(obj, type) {
		for (var i = 0; i < obj.components.length; i++) {
			var component = obj.components[i];
			if (component.type == type) {
				return component;
			}
		}
	}

	function createLayer(name, zindex, drawFunc) {
		// creates a canvas layer in the dom
		console.log("creating layer " + name);
		// create the layer in dom
		var body = document.body;
		var layerDiv = document.createElement("DIV");
		var can = document.createElement("CANVAS");
		can.id = name + "Canvas";
		can.width = 720;
		can.height = 480;
		layerDiv.id = name + "Div";
		layerDiv.style.zIndex = zindex; //body.childElementCount;
		layerDiv.appendChild(can);
		body.appendChild(layerDiv);
		// define the layer
		var layer = {};
		layer.name = name;
		layer.draw = drawFunc;
		layer.visible = true;
		layer.div = layerDiv;
		layer.can = can;
		layer.ctx = can.getContext("2d");
		layers[name] = layer;
		return layer;
	}

///////////////////////////////////////
//
//	LOADERS
//
///////////////////////////////////////

	function loadGame(callback) {
		// loads the game.js file and fires a callback when game.js is done loading all deps
		console.log("loading game.js");
		var script = document.createElement("SCRIPT");
		script.src = path;
		script.onload = function() {
			console.log("loading game.js fired its onload callback");
			callback();
			script.remove();
		}
		document.body.appendChild(script);
	}

	function loadScript(path, callback) {
		// loads a script file from the given path
		console.log("loading script at path " + path);
		var script = document.createElement("SCRIPT");
		script.src = path;
		script.onload = function() {
			console.log("loading script at path " + path  + " fired its onload callback");
			if (callback) callback();
			script.remove();
		}
		document.body.appendChild(script);
	}

	var loaded = 0;
	var loadcount = 0;
	var finalCallback = null;

	function loadBatch(requires, callback) {
		// loads multiple files
		// if we just started a load chain, save the initial callback as the final callback
		//	because callback will get overwritten by recursive calls to loadRequirements
		//	for any sub-dependencies
		if (loadcount == 0) {
			finalCallback = callback;
			console.log("load chain started with " + requires.length + " modules pending");
		}
		// keep track of the total number of modules being loaded
		loadcount += requires.length;
		// start the load chain
		requires.forEach(function(r) {
			loadScript(r.path, function() {
				// this file has been loaded
				loaded++;
				console.log(r.name + " module finished loading");
				// we can now grab the module that was loaded and load any of its dependencies too
				var module = ASTRAL[r.name];
				if (module && module.requires) {
					console.log(r.name + " module has " + module.requires.length + " dependencies");
					loadBatch(module.requires, function() {
						if (module.init) {
							//module.init();
						}
					});
				}
				else {
					console.log(r.name + " module has 0 dependencies");
					if (module && module.init) {
						//module.init();
					}
				}
				console.log("loaded " + loaded + " of " + loadcount + " modules");
				// if all dependencies have been loaded we are done!
				if (loaded == loadcount) {
					finalCallback();
				}
			});
		});
	}

	function loadImage(path, callback) {
		// loads an image dynamically and fires a callback returning the js image object
		console.log("loading image at path " + path);
		var img = new Image();
		img.src = path;
		img.crossOrigin = "Anonymous";
    	img.onload = function() {
    		// TODO: this gets fired a second time if we set img.src from spriter.js...
    		//	switch back to addEventListener()
    		images[path] = img;
    		if (callback) callback(img);
    	}
	    img.onerror = function() {console.log("failed to load image " + path); img = null;}
	}

	function loadJson(name, callback) {
		// loads a json-formatted file (doesn't have to be .json) and fires callback returning a string,
		//	sometimes you just want the string and not the json.parse() object, so we don't parse here,
		//	but you can parse in your callback
	    var req = new XMLHttpRequest();
	    //req.overrideMimeType("application/json");
	    req.open("GET", name, true);
	    req.responseType = "text"; // firefox...if we set this to json it will return a json object, not text!!
	    req.onreadystatechange = function() {
	    	console.log(req);
	    	var statusPassing = "200";
	    	var statusPassingFirefox = 200;
	    	// if working from the filesystem, override statusPassing to "0" since
	    	//	a json file returns req.status == "0" on success
			if (window.location.protocol == "file:") {
				statusPassing = "0";
			}
			if (req.readyState == 4) {
				if (req.status == statusPassing || req.status == statusPassingFirefox) {
					//callback(req.responseText);
					console.log("READY");
					callback(req.response);
				}
			}
	    };
	    req.send(null);
	}

	function loadScene(path, callback) {
		loadJson(path, function(data) {
			loadSceneData(data, path, callback);
		});
	}

	function loadSceneData(data, path, callback) {
		ASTRAL.do("beforesceneload"); // e.g. editor can listen to this and clear its scene list
		sceneData = [];
		try {
			if (data) {
				sceneData = JSON.parse(data);
			}
			else {
				sceneData = [];
			}
			currentScene = path;
			sceneData = sceneData;
			loadObjects(sceneData);
			console.log("loaded scene " + path + ", contains " + sceneData.length + " root nodes");
			if (callback) callback();
		}
		catch (e) {
			ASTRAL.error("Failed to load scene " + path + ". " + e, 3000);
			sceneData = [];
		}
	}

	// TODO: maybe modify this to accept parent as the first parameter, which would be the
	//	parent object in the recursive relationship, so that we can call obj.parent to get
	//	the object's parent object which would be highly useful
	function loadObjects(objects, path, level, parent) {
		//console.log("LOADING", objects);
		// walks the objects array recursively to get the object path/level and calls loadObject()
		//	on each object to massage the cold json data into runtime data
		if (!path) path = "";
		if (!level) level = 0;
		level++;
		var levelRoot = path;
		for (var key in objects) {
			var obj = objects[key];
			if (parent) obj.parent = parent;
			obj.path = levelRoot + "/" + obj.name;
			obj.level = level;
			createObject(obj);
			if (obj.objects) {
				loadObjects(obj.objects, obj.path, level, obj);
			}
		}
		level = 1;
	}

	// TODO: createObject can be used in different ways
	//	1) data is null, create a new empty object
	//	2) data is object data, create object using this data
	//	3) data is object data with no object id, create object using this data and assign new id
	function createObject(data, name) {
		console.log("createObject ::", data, name);
		// create the object empty or using the data passed in
		var obj;
		if (data) {
			obj = data;
			if (!obj.id) {
				obj.id = Date.parse(new Date().toUTCString());
				//ASTRAL.sceneData.push(obj);
				sceneData.push(obj);
			}
		}
		else {
			obj = {};
			obj.id = Date.parse(new Date().toUTCString());
			obj.name = name;
			//sceneData[obj.id] = obj;
			//sceneData.push(obj); // TODO: why isnt this working
			//ASTRAL.sceneData.push(obj);
			sceneData.push(obj);
		}
		// props
		if (!obj.x) obj.x = 0;
		if (!obj.y) obj.y = 0;
		if (!obj.vx) obj.vx = 0;
		if (!obj.vy) obj.vy = 0;
		if (!obj.rot) obj.rot = 0;
		if (!obj.scale) obj.scale = 1;
		if (!obj.speed) obj.speed = 0.088;
		//console.log("OBJ", obj);
		obj.channels = [];
		// observer
		obj.onHandlers = [];
		obj.on = function(name, callback) {
			var handlers = this.onHandlers[name];
			if (!handlers) {
				this.onHandlers[name] = [];
				console.log("created custom event handler '" + name + "' for object '" + this.name + "'")
			}
			this.onHandlers[name].push(callback);
			console.log("object '" + this.name + "' subscribed to event '" + name + "'");
		}
		obj.do = function(name, payload) {
			// function doHandler(name, payload) {
			// 	var func = onHandlers[name];
			// 	if (func) func(payload);
			// }		
			//console.log("entity '" + this.name + "' fired event '" + name + "'");
			var handlers = this.onHandlers[name];
			if (handlers != null) {
				for (var i in handlers) {
					var callback = handlers[i];
					callback(payload);
				}
			}
			else {
				//console.log("warning", "object.do() failed because no handler exists with the name '" + name + "'");
			}
		}
		// components
		if (!obj.components) {
			obj.components = [];
		}
		else {
			for (var key in obj.components) {
				var componentInstance = obj.components[key];
				// TODO: if the base component changed, we need to detect differences and
				//	update the existing instances on objects, then create a log file
				//	outlining the changes made
				// if the component uses any required resources, load them now
				if (componentInstance.type == "image") {
					// TODO: we don't want to call loadImage() for images already loaded...
					loadImage(componentInstance.path, function(img) {
						obj.baseWidth = img.width;
						obj.baseHeight = img.height;
						obj.width = obj.baseWidth * obj.scale;
						obj.height = obj.baseHeight * obj.scale;
					});
				}
				// else if (componentInstance.type == "atlas") {
				// 	// TODO: this is wrong...we need to load the image referenced by the atlas, not the atlas itself
				// 	loadImage(componentInstance.path);
				// }
				else {
					if (componentInstance.type == "atlas") {
						// TODO: this is wrong...we need to load the image referenced by the atlas, not the atlas itself
						loadImage(componentInstance.path);
					}

					// obtain the base component for this object's component instance
					var componentBase = components[componentInstance.type];
					//console.log("COMPONENT", componentInstance, componentBase, components);
					if (componentBase) {
						console.log("BASE", componentBase);
						// merge the saved component data with the runtime props
						if (componentBase.applyRuntimeProps) {
							componentBase.applyRuntimeProps(componentInstance);
							console.log("applied component instance runtime props to", componentInstance);
						}

						// applyBaseProps - make sure the saved component data (instance data) 
						// matches the existing schema in the component's base .js file
						// we use versionMatch to make sure this only triggers one time, until the next load
						if (componentInstance.runtime) {
						  	if (!componentInstance.runtime.versionMatch) {
								updateComponentInstanceFromBase(componentInstance, componentBase);
							}
						}
					}
					else {
						console.log("WARNING: could not find componentBase '" + componentInstance.type + "', this means an object is using a component which hasn't been loaded or does not exist");
					}
				}
			}		
		}
		ASTRAL.do("objectcreated", obj); // e.g. editor can listen to this and create an item in the scene list
		return obj;
	}

	function updateComponentInstanceFromBase(componentInstance, componentBase) {
		//console.log("COMPARE", componentBase.instance);
		var componentBaseProps = componentBase["instance"]();
		var componentInstanceProps = componentInstance;

		//console.log("COMPARE", "OBJECT", componentInstance.type);
		//console.log("COMPARE", componentBaseProps, componentInstanceProps);

		for (var key in componentBaseProps) {
			//var propName = componentBaseProps[key];
			//console.log("COMPARE PROPNAME", propName, componentInstanceProps[propName]);
			if (componentInstanceProps[key] != null) {
				//console.log("COMPARE RESULT", "MATCH", key);
				// do nothing, we're good
			}
			else {
				//console.log("COMPARE RESULT", "MISSING", key);
				// add the missing prop with the default value
				componentInstance[key] = componentBaseProps[key];
				console.log("added missing property '" + key + "'' to component instance '" + componentInstance.type + "'");
			}
		}

		// find extras
		for (var key in componentInstanceProps) {
			if (componentBaseProps[key] == null) {
				console.log("COMPARE RESULT", "EXTRA", key);
				// remove the extra prop
				// TODO: this is destructive, implement later
				//delete componentInstance[key];
			}
		}

		// TODO: better to build a list of the missing and extras, then solve them afterwards?

		// if we update the instance, set a flag so we dont do this til next load
		componentInstance.runtime.versionMatch = true;

		// TODO: notify user?
	}

	function deleteInspectedObject() {
		deleteObject(ASTRAL.editor.inspectedObject);
	}

	// TODO: this doesnt work for child objects we need to recursively search
	function deleteObject(obj) {
		var oldId = obj.id;
		var oldName = obj.name;

		// iterate the sceneData looking for the matching obj
		// for (var i = 0; i < sceneData.length; i++) {
		// 	if (obj.id == sceneData[i].id) {
		// 		sceneData.splice(i, 1);
		// 		ASTRAL.do("objectdeleted", obj);
		// 	}
		// 	for (var ii = 0; ii < sceneData[i].objects; ii++) {
		// 		deleteObject(sceneData[i].objects[ii]);
		// 	}
		// }

		// TODO: instead implement a parent prop on obj and call obj.parent.objects to iterate
		//	the parent's children and remove the one matching obj
		var collection = sceneData;
		if (obj.parent) collection = obj.parent.objects;
		for (var i = 0; i < collection.length; i++) {
			if (obj.id == collection[i].id) {
				collection.splice(i, 1);
				ASTRAL.do("objectdeleted", obj);
			}
		}

		// if (obj.parent) {

		// }
		// else {
		// 	for (var i = 0; i < sceneData.length; i++) {
		// 		if (obj.id == sceneData[i].id) {
		// 			sceneData.splice(i, 1);
		// 			ASTRAL.do("objectdeleted", obj);
		// 		}
		// 	}
		// }
		// console.log(obj.parent);

		console.log("deleted object '" + oldName + "' id " + oldId);
	}

	function loadComponentResources() {

	}

///////////////////////////////////////
//
//	INPUT
//
///////////////////////////////////////

// TODO: make it pub/sub and let gamedev control more of this

	function input() {

		for (var key in sceneData) {
			updateObjectInputState(sceneData[key]);
		}


		//mouseB1Old = mouseB1;
		// if (mouseB1 == "beforemousedown") {
		// 	mouseB1 = "mousedown";
		// 	console.log("mouse button 1 state set to mousedown");
		// }

		// TODO: mousedown event could come in here before we handle it for objects, effectively
		//	skipping over the mousedown event which is undesired...we need to persist the event
		//	by one extra frame

		if (mouseB1 == "mousedown") {
			if (mouseB1Handled) {
				mouseB1 = "aftermousedown";
			}
			else {
				mouseB1Handled = true;
			}
			console.log("mouse button 1 state set to aftermousedown");
		}
		else if (mouseB1 == "mouseup") {
			//mouseB1Old = mouseB1;
			mouseB1 = "click";
			console.log("mouse button 1 state set to click");
		}
		else if (mouseB1 == "click") {
			//mouseB1Old = mouseB1;
			mouseB1 = "nothing";
			console.log("mouse button 1 state set to idle");
		}

		var vx = 0
		var vy = 0;
		if (moveUp == true) {
			if (moveDown == true) {
				vy = 0;
			}
			else {
				vy = -1;
			}
		}
		if (moveDown == true) {
			if (moveUp == true) {
				vy = 0;
			}
			else {
				vy = 1;
			}
		}
		if (moveLeft == true) {
			if (moveRight == true) {
				vx = 0;
			}
			else {
				vx = -1;
			}
		}
		if (moveRight == true) {
			if (moveLeft == true) {
				vx = 0;
			}
			else {
				vx = 1;
			}
		}

		// if the input state changed since last time we checked, notify the server
		finalInput = vx + "," + vy;
		if (finalInput != lastInput) {
			lastInput = finalInput;
			//send({event: "move", data: {vx: vx, vy: vy}});
			// TODO: fix tight coupling (see note in Docs)...this was for testing bridge/server but should be moved into a game script since it is game specific
			//ASTRAL.bridge.queueSend("*move," + vx + "," + vy + "," + ASTRAL.game.myObject.x + "," + ASTRAL.game.myObject.y);
			console.log("serverside movement code needs reimplementation");
		}
	}

///////////////////////////////////////
//
//	HELPERS & GENERICS
//
///////////////////////////////////////

	// function onHandler(name, func) {
	// 	onHandlers[name] = func;
	// }

	// function doHandler(name, payload) {
	// 	var func = onHandlers[name];
	// 	if (func) func(payload);
	// }

	function onHandler(name, callback) {
		// get handler array matching name
		var handlers = onHandlers[name];
		if (!handlers) {
			// if no handler array matching name, make the array now
			onHandlers[name] = [];
			console.log("created global event handler '" + name + "'");
		}
		// add the handler to the handler array
		onHandlers[name].push(callback);
		console.log("added event to '" + name + "'");
	}

	function doHandler(name, payload) {
		// get handler array matching name
		var handlers = onHandlers[name];
		if (handlers != null) {
			// there's a handler array! call all listeners in the array
			for (var i in handlers) {
				var callback = handlers[i];
				callback(payload);
			}
		}
	}

	// function component(name, func) {
	// 	var component = func();
	// 	components[name] = component;
	// }

	function isFunction(functionToCheck) {
	 return functionToCheck && {}.toString.call(functionToCheck) === '[object Function]';
	}

	function setPanelLayout(panels1, panels2, panels3, panels4) {
		// accepts four arrays defining which panels should be moved to which of the four sidebars
		var panels = document.querySelectorAll(".sidebar .panel");
		panels.forEach(function(p) {
			p.style.display = "none";
		});

		panels1.forEach(function(p) {
			var el = document.getElementById(p);
			el.style.display = "block";
			sidebar1.appendChild(el);
		});

		panels2.forEach(function(p) {
			var el = document.getElementById(p);
			el.style.display = "block";
			sidebar2.appendChild(el);
		});

		panels3.forEach(function(p) {
			var el = document.getElementById(p);
			el.style.display = "block";
			sidebar3.appendChild(el);
		});

		panels4.forEach(function(p) {
			var el = document.getElementById(p);
			el.style.display = "block";
			sidebar4.appendChild(el);
		});
	}

	function getFileInfo(path) {
		// gets basic info about a file path
		// TODO: this is also in server.js but paths differ by use of \\
		var info = {};
		info.path = path;
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
		console.log("got file info for " + info.name + ":", info);
		return info;
	}

	function getRandomColor() {
		// gets a random hex color value
		var letters = '0123456789ABCDEF';
		var color = '#';
		for (var i = 0; i < 6; i++) {
			color += letters[Math.floor(Math.random() * 16)];
		}
		return color;
	}

	function getRandomNumber(min, max, signed) {
		var rn = 0;
		var rn = Math.floor((Math.random() * max) + min);
		if (signed == true) {
			rn = rn * (Math.round(Math.random()) * 2 - 1);
		}
		return rn;
	}

	function playSound(path) {
		if (muteSound == true) return;
		var snd = new Audio(path);
		snd.play();

		// var media = new Audio(path);
		// const playPromise = media.play();
		// if (playPromise !== null){
		//     playPromise.catch(() => { media.play(); })
		// }
	}

	function moveDomElement(el, offsetX, offsetY) {
		// moves a dom element using its top/left style
		var x = parseInt(el.style.left.replace("px", ""));
		var y = parseInt(el.style.top.replace("px", ""));
		x += offsetX;
		y += offsetY;
		el.style.left = x + "px";
		el.style.top = y + "px";
	}

	function sceneDataToJson() {
		// returns a json string for the given data, this is the top level function that gets
		//	called when saving a scene to disk
		//var filtered = filterSceneData(sceneData);
		var clone = cloneObject(sceneData, formatObject);
		delete clone.runtime; // we don't want to save this to disk
		let json = JSON.stringify(clone, null, 2);
		return json;
	}

	// function filterSceneData(data) {
	// 	// clones and formats the data for saving to disk as json
	// 	let filteredData = [];
	// 	for (let prop in data) {
	// 		if (data.hasOwnProperty(prop)) {
	// 		  filteredData[prop] = data[prop];
	// 		  formatObject(filteredData[prop]);
	// 		}
	// 	}
	// 	return filteredData;
	// 	// https://medium.com/@Farzad_YZ/3-ways-to-clone-objects-in-javascript-f752d148054d
	// }

	function cloneObject(obj, formatter) {
		// clones an object
		let clone = [];
		for (let prop in obj) {
			if (obj.hasOwnProperty(prop)) {
			  clone[prop] = obj[prop];
			  if (formatter) formatter(clone[prop]);
			}
		}
		return clone;
		// https://medium.com/@Farzad_YZ/3-ways-to-clone-objects-in-javascript-f752d148054d
	}

	function formatObject(obj) {
		// formats the gameobject for saving to disk as json by removing any runtime 
		//	props and circular refs

		// delete obj.do;
		// delete obj.isMouseOver;
		// delete obj.isDragging;
		// delete obj.level;
		// delete obj.on;
		// delete obj.onHandlers;
		// delete obj.parent;
		// if (obj.objects) {
		// 	for (var i = 0; i < obj.objects.length; i ++) {
		// 		formatObject(obj.objects[i]);
		// 	}
		// }
	}

	function saveSceneData(data) {
		var json = sceneDataToJson();
		ASTRAL.bridge.sendNow("*savescene," + ASTRAL.currentScene + "," + json);
	}

	function openSceneDataInNewTab() {
		var json = sceneDataToJson();
		openJsonInNewTab(json);
	}

	function downloadSceneData() {
		var json = sceneDataToJson();
		downloadJsonData(json, "newscene.scene");
	}

	function downloadJsonData(json, filename) {
		var blob = new Blob([json], {type:"application/json"});
		var url = URL.createObjectURL(blob);
		var a = document.createElement("A");
		a.download = filename;
		a.href = url;
		a.click();
	}

	function openJsonInNewTab(json) {
		console.log("openJsonInNewTab json:", json);
		var x = window.open();
	    x.document.open();
	    x.document.write('<html><body><pre>' + json + '</pre></body></html>');
	    x.document.close();
	}

	function setEndOfContenteditable(el) {
	    var range,selection;
        range = document.createRange();//Create a range (a range is a like the selection but invisible)
        range.selectNodeContents(el);//Select the entire contents of the element with the range
        range.collapse(false);//collapse the range to the end point. false means collapse to end rather than the start
        selection = window.getSelection();//get the selection object (allows you to change selection)
        selection.removeAllRanges();//remove any selections already made
        selection.addRange(range);//make the range you have just created the visible selection
        // https://stackoverflow.com/questions/1125292/how-to-move-cursor-to-end-of-contenteditable-entity
	}

	function error(msg, duration) {
		var el = document.createElement("DIV");
		el.className = "error";
		el.innerHTML = msg;
		document.body.appendChild(el);
		setTimeout(function() {
			el.classList.add("errorfade");
			setTimeout(function() {
				el.remove();
			}, 1000);
		}, duration);
		//setTimeout(function() {el.remove()}, 1000);
	}

	// function collides(obj1, obj2) {
	// 	// TODO: finding components and parsing int is just too much crap we dont need to be doing
	// 	//	if we optimize elsewhere
	// 	var c1 = findComponentByType(obj1, "collider");
	// 	var c2 = findComponentByType(obj2, "collider");
	// 	var r1 = {
	// 		left: obj1.x,
	// 		top: obj1.y,
	// 		right: obj1.x + parseInt(c1.width),
	// 		bottom: obj1.y + parseInt(c1.height)
	// 	}
	// 	var r2 = {
	// 		left: obj2.x,
	// 		top: obj2.y,
	// 		right: obj2.x + parseInt(c2.width),
	// 		bottom: obj2.y + parseInt(c2.height)
	// 	}
	// 	return intersectRect(r1, r2);
	// }

	function find(selector) {
		// parse the selector to determine what to find
		//	# prefix means look at the object's name/id
		//		e.g. "#brick" means look for an object whose name is brick
		//	* prefix or suffix means any characters before/after the main word
		//		e.g. "#*brick*"" means look for an object with brick in the name
		//		e.g. "#brick*"" means look for an object whose name starts with brick
		//		e.g. "#*brick" means look for an object whose name ends with brick
		//  > connector means select a child object of the parent object matching the selector
		//		e.g. "#brick > #wings" selects an object whose name is wings and is a child of brick
		//	: connector means select a child component of the parent object matching the selector
		//		e.g. "#brick : collider" selects all colliders on all objects named brick
		//		the above would return an object with an array of the selected colliders, with the 
		//		same methods/properties as the colliders, and when we call one of these, such
		//		as the speed, it would set the speed for all the colliders in the selection

		// how to parse the selector

		var selection = {};
		selection.objects = [];
		if (selector.startsWith("#")) {
			// search by object name
			// grab the name, including any control chars
			var name = selector.substring(1);
			for (var key in sceneData) {
				var obj = sceneData[key];
				if (obj.name == name) {
					selection.objects.push(obj);
					// for each of this object's methods, add a pointer to it on the selection object
					for (var m in obj) {
						if (typeof obj[m] == "function") {
							console.log("METHOD", m, obj[m]);
							// now we need to create an equivalent method on the selection, if it
							//	doesn't already exist, and link it to this object's same method
							if (!selection[m]) {
								selection[m] = obj[m];
							}
						}
					}
				}
			}
		}
		console.log("SELECTION", selection);
		console.log(selection.play);
		ASTRAL.pauseUpdate();
		return selection;
	}

	function intersectRect(r1, r2) {
		// https://stackoverflow.com/questions/2752349/fast-rectangle-to-rectangle-intersection
		return !(r2.left > r1.right || 
	       r2.right < r1.left || 
	       r2.top > r1.bottom ||
	       r2.bottom < r1.top);
	}

	function intersectRect2(r1, r2) {
		var left = false;
		var right = false;
		var top = false;
		var bottom = false;
		var horz = false;
		var vert = false;
		var embedX = 0;
		var embedY = 0;
		var reflectX = 0;
		var reflectY = 0;

		if (r1.left > r2.left) {
			if (r1.left < r2.right) {
				// something on our left
				//console.log("LEFT");
				left = true;
				horz = true;
				embedX = r2.right - r1.left;
			}
		}
		if (r1.right > r2.left) {
			if (r1.right < r2.right) {
				// something on our right
				//console.log("RIGHT");
				right = true;
				horz = true;
				embedX = r1.right - r2.left;
			}
		}
		if (r1.top > r2.top) {
			if (r1.top < r2.bottom) {
				// something above us
				//console.log("TOP");
				top = true;
				vert = true;
				embedY = r2.bottom - r1.top;
			}
		}
		if (r1.bottom > r2.top) {
			if (r1.bottom < r2.bottom) {
				// something below us
				//console.log("BOTTOM");
				bottom = true;
				vert = true;
				embedY = r1.bottom - r2.top;
			}
		}

		// TODO: probably need to check for 2 or 3 side collision, if 2 side then we allow an x/y
		//	correction, if 3 side we allow an x or y correction only

		if (horz && vert) {
			// at least two edges embed which means we have a collision
			//console.log("WHAM", r1, r2, top, right, bottom, left);
			// the shallower intersect determines reflect direction
			if (embedX < embedY) {
				reflectX = -1;
				reflectY = 1;
			}
			else {
				reflectX = 1;
				reflectY = -1;
			}
		}

		// TODO: we need an accurate embed x/y so we can subtract that from the obj1 pos to put
		//	it just outside obj2 bounds

		return {
			"top": top,
			"right": right,
			"bottom": bottom,
			"left": left,
			"horz": horz,
			"vert": vert,
			"embedX": embedX,
			"embedY": embedY,
			"reflectX": reflectX,
			"reflectY": reflectY
		}
	}

	return {
		on:onHandler,
		do:doHandler,
		init:init,
		sceneData:sceneData,
		layers:layers,
		images:images,
		createLayer:createLayer,
		createObject:createObject,
		cloneObject:cloneObject,
		deleteInspectedObject:deleteInspectedObject,
		deleteObject:deleteObject,
		/*createGameObject:createGameObject,*/
		/*loadGameObject:loadGameObject,*/
		findObject:findObject,
		find:find,
		loadJson:loadJson,
		loadImage:loadImage,
		loadScene:loadScene,
		loadBatch:loadBatch,
		playSound:playSound,
		getFileInfo:getFileInfo,
		sceneDataToJson:sceneDataToJson,
		saveSceneData:saveSceneData,
		downloadSceneData:downloadSceneData,
		openJsonInNewTab:openJsonInNewTab,
		findComponentByType:findComponentByType,
		error:error,
		setPanelLayout:setPanelLayout,
		components:components,
		gameInfo:gameInfo,
		isFunction:isFunction,
		formatObject:formatObject,
		setEndOfContenteditable:setEndOfContenteditable,
		startGameLoop:startGameLoop,
		stopGameLoop:stopGameLoop,
		startUpdate:startUpdate,
		stopUpdate:stopUpdate,
		getRandomNumber:getRandomNumber,
		//collides:collides,
		intersectRect:intersectRect,
		intersectRect2:intersectRect2,
		staticObjects:staticObjects,
		physicsObjects:physicsObjects,
		toggleMute:toggleMute,
		muteSound:muteSound,
		pauseUpdate:pauseUpdate,
		get mouseX() {
			return mouseX;
		},
		get mouseY() {
			return mouseY;
		},
		get game() {
			return game;
		}
	}
}());