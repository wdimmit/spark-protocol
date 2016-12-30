/*
*   Copyright (c) 2015 Particle Industries, Inc.  All rights reserved.
*
*   This program is free software; you can redistribute it and/or
*   modify it under the terms of the GNU Lesser General Public
*   License as published by the Free Software Foundation, either
*   version 3 of the License, or (at your option) any later version.
*
*   This program is distributed in the hope that it will be useful,
*   but WITHOUT ANY WARRANTY; without even the implied warranty of
*   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
*   Lesser General Public License for more details.
*
*   You should have received a copy of the GNU Lesser General Public
*   License along with this program; if not, see <http://www.gnu.org/licenses/>.
*/

var settings = require('../settings.js');
var CryptoLib = require('../lib/ICrypto.js');
var SparkCore = require('../clients/SparkCore.js');
var EventPublisher = require('../lib/EventPublisher.js');
var utilities = require('../lib/utilities.js');
var logger = require('../lib/logger.js');
var crypto = require('crypto');
var ursa = require('ursa');
var when = require('when');
var path = require('path');
var net = require('net');
var fs = require('fs');
var moment = require('moment');

const serverid = '10.0.1.5;
var ipc=require('node-ipc');
ipc.config.id   = 'cloud-server-'+serverid;
ipc.config.retry= 0;

ipc.connectToNet(
    'routingdb',
    '10.0.1.7',
    2000,
    function(){
        ipc.of.routingdb.on(
            'connect',
            function(){
                ipc.log('## connected to routingdb ##'.rainbow, ipc.config.delay);
            }
        );
        ipc.of.routingdb.on(
            'disconnect',
            function(){
                ipc.log('disconnected from routingdb'.notice);
            }
        );
        ipc.of.routingdb.on(
            'results',  //any event or message type your server listens for 
            function(data){
                ipc.log('got a message from routingdb : '.debug, data);
            }
        );
    }
);

var DeviceServer = function (options) {
    this.options = options;
    this.options = options || {};
    settings.coreKeysDir = this.options.coreKeysDir = this.options.coreKeysDir || settings.coreKeysDir;

    this._allCoresByID = {};
    this._attribsByID = {};
    this._allIDs = {};

    this.init();
};

DeviceServer.prototype = {
    _allCoresByID: null,
    _attribsByID: null,
    _allIDs: null,


    init: function () {
        this.loadCoreData();
    },

    addCoreKey: function(coreid, public_key) {
        try{
            var fullPath = path.join(this.options.coreKeysDir, coreid + ".pub.pem");
            fs.writeFileSync(fullPath, public_key);
            return true;
        }
        catch (ex) {
            logger.error("Error saving new core key ", ex);
        }
        return false;
    },


    loadCoreData: function () {
        var attribsByID = {};

        if (!fs.existsSync(this.options.coreKeysDir)) {
            console.log("core keys directory didn't exist, creating... " + this.options.coreKeysDir);
            fs.mkdirSync(this.options.coreKeysDir);
        }

        var files = fs.readdirSync(this.options.coreKeysDir);
        for (var i = 0; i < files.length; i++) {
            var filename = files[i],
                fullPath = path.join(this.options.coreKeysDir, filename),
                ext = utilities.getFilenameExt(filename),
                id = utilities.filenameNoExt(utilities.filenameNoExt(filename));

            if (ext == ".pem") {
            	if (!this._allIDs[id]) {
                	console.log("found pem " + id);
                	this._allIDs[id] = true;
				}
                if (!attribsByID[id]) {
                    var core = {}
                    core.coreID = id;
                    attribsByID[id] = core;
                }
            }
            else if (ext == ".json") {
                try {
                    var contents = fs.readFileSync(fullPath);
                    var core = JSON.parse(contents);
                    if (!attribsByID[core.coreID]) {
                    	core.coreID = core.coreID || id;
                    	attribsByID[core.coreID ] = core;
                    }
					if (!this._allIDs[core.coreID]) {
                    	console.log("found json " + core.coreID);
                    	this._allIDs[core.coreID ] = true;
                    }
                }
                catch (ex) {
                    logger.error("Error loading core file " + filename);
                }
            }
        }

        this._attribsByID = attribsByID;
    },

    saveCoreData: function (coreid, attribs) {
        try {
            //assert basics
            attribs = attribs || {};
//            attribs["coreID"] = coreid;

            var jsonStr = JSON.stringify(attribs, null, 2);
            if (!jsonStr) {
                return false;
            }

            var fullPath = path.join(this.options.coreKeysDir, coreid + ".json");
            fs.writeFileSync(fullPath, jsonStr);
            return true;
        }
        catch (ex) {
            logger.error("Error saving core data ", ex);
        }
        return false;
    },

    getCore: function (coreid) {
        return this._allCoresByID[coreid];
    },
    getCoreAttributes: function (coreid) {
        //assert this exists and is set properly when asked.
        this._attribsByID[coreid] = this._attribsByID[coreid] || {};
        //this._attribsByID[coreid]["coreID"] = coreid;

        return this._attribsByID[coreid];
    },
    setCoreAttribute: function (coreid, name, value) {
        this._attribsByID[coreid] = this._attribsByID[coreid] || {};
        this._attribsByID[coreid][name] = value;
        this.saveCoreData(coreid, this._attribsByID[coreid]);
        return true;
    },
    getCoreByName: function (name) {
        //var cores = this._allCoresByID;
        var cores = this._attribsByID;
        for (var coreid in cores) {
            var attribs = cores[coreid];
            if (attribs && (attribs.name == name)) {
                return this._allCoresByID[coreid];
            }
        }
        return null;
    },

    /**
     * return all the cores we know exist
     * @returns {null}
     */
    getAllCoreIDs: function () {
        return this._allIDs;
    },

    /**
     * return all the cores that are connected
     * @returns {null}
     */
    getAllCores: function () {
        return this._allCoresByID;
    },

	/* publish special events */
	publishSpecialEvents: function (name, data, coreid) {
		return global.publisher.publish(false,name,null,data,60,moment(new Date()).toISOString(),coreid);
	},

//id: core.coreID,
//name: core.name || null,
//last_app: core.last_flashed_app_name || null,
//last_heard: null

    start: function () {
        global.settings = settings;

        //
        //  Create our basic socket handler
        //

        var that = this,
            connId = 0,
            _cores = {},
            server = net.createServer(function (socket) {
                process.nextTick(function () {
                    try {
                        var key = "_" + connId++;
                        logger.log("Connection from: " + socket.remoteAddress + ", connId: " + connId);

                        var core = new SparkCore();
                        core.socket = socket;
                        core.startupProtocol();
                        core._connection_key = key;

                        //TODO: expose to API


                        _cores[key] = core;
                        core.on('ready', function () {
                            logger.log("Core online!");
                            var coreid = this.getHexCoreID();
                            that._allCoresByID[coreid] = core;
                            that._attribsByID[coreid] = that._attribsByID[coreid] || {
                                coreID: coreid,
                                name: null
                            };
                            that._attribsByID[coreid].spark_product_id = this.spark_product_id;
                            that._attribsByID[coreid].product_firmware_version = this.product_firmware_version;
                            that._attribsByID[coreid].ip = this.getRemoteIPAddress();
                            that.saveCoreData(coreid, that._attribsByID[coreid]);
                            
                            //Update routingdb
                            ipc.of.routingdb.emit(
                                'update', 
                                JSON.stringify({deviceid: coreid, server: serverid});
                            );
                            //End routing code

                            that.publishSpecialEvents('spark/status', 'online', coreid);
                        });
                        core.on('disconnect', function (msg) {
                        	if(core.coreID in that._allCoresByID && that._allCoresByID[core.coreID]._connection_key == core._connection_key) {
                                that.publishSpecialEvents('spark/status', 'offline', core.coreID);
                            }
                            logger.log("Session ended for " + core._connection_key);
                            delete _cores[key];
                        });
                    }
                    catch (ex) {
                        logger.error("core startup failed " + ex);
                    }
                });
            });

        global.cores = _cores;
        global.publisher = new EventPublisher();
        global.publisher.setMaxListners(50);
        
        server.on('error', function () {
            logger.error("something blew up ", arguments);
        });


        //
        //  Load the provided key, or generate one
        //
        if (!fs.existsSync(settings.serverKeyFile)) {
            console.warn("Creating NEW server key");
            var keys = ursa.generatePrivateKey();


            var extIdx = settings.serverKeyFile.lastIndexOf(".");
            var derFilename = settings.serverKeyFile.substring(0, extIdx) + ".der";
            var pubPemFilename = settings.serverKeyFile.substring(0, extIdx) + ".pub.pem";

            fs.writeFileSync(settings.serverKeyFile, keys.toPrivatePem('binary'));
            fs.writeFileSync(pubPemFilename, keys.toPublicPem('binary'));

            //DER FORMATTED KEY for the core hardware
            //TODO: fs.writeFileSync(derFilename, keys.toPrivatePem('binary'));
        }


        //
        //  Load our server key
        //
        console.info("Loading server key from " + settings.serverKeyFile);
        CryptoLib.loadServerKeys(
            settings.serverKeyFile,
            settings.serverKeyPassFile,
            settings.serverKeyPassEnvVar
        );

        //
        //  Wait for the keys to be ready, then start accepting connections
        //
        server.listen(settings.PORT, function () {
            logger.log("server started", { host: settings.HOST, port: settings.PORT });
        });


    }

};
module.exports = DeviceServer;
