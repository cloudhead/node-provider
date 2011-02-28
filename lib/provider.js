//
// provider.js - 'Accept'-based content serving
//
var events = require('events'),
    md5 = require('lib/md5'),
    http = require('http');

var filters = require('./provider/filters');
this.logger = require('./provider/logger');

this.MIMEPATTERN = /(?:(\*)\/(\*)|([a-z0-9-]+)\/([a-z+0-9_.-]+|\*))(?:;\s*q=(\d\.\d))?/;

this.Response = function (pipeline, server) {
    this.server = server;
    this.headers = {};
    this.status = 200;
    this.buffer = [];
    this.start = Date.now();
    this.pipeline = pipeline;
    this.index = 0;
};
this.Response.prototype = {
    break: function (status, headers, data) {
        this.writeHead(status, headers);
        this.end(data);
    },
    return: function () {},
    continue: function (req, res) {
        var that = this;
        this.pipeline[this.index ++].call(this.server, req, res, function (req, res) {
            that.continue(req, res);
        });
    },
    end: function (data) {
        this.time = Date.now() - this.start;
        http.ServerResponse.prototype.end.call(this.__proto__, data);
    },
    write: function () {
        http.ServerResponse.prototype.write.apply(this, arguments);
    },
    writeHead: function (status, headers) {
        var that = this;
        if (headers) { this.setHeaders(headers) }
        this.status = status || this.status
        http.ServerResponse.prototype.writeHead.call(this.__proto__, this.status, this.headers);
    },
    setHeader: function (key, value) {
        this.headers[key] = value;
    },
    setHeaders: function (headers) {
        var that = this;
        Object.keys(headers).forEach(function (k) {
            that.headers[k] = headers[k] || that.headers[k];
        });
    },
    setStatus: function (status) {
        this.status = status;
    }
};
this.Response.prototype.__proto__ = http.ServerResponse.prototype;

var Cache = function () {
    this.store = {};
};
Cache.prototype.mime = function (mime) {
    var that = this;
    return {
        set: function (id, data) {
            that.store[id] = that.store[id] || {};
            that.store[id][mime] = data;
        },
        exists: function (id) {
            return !! (that.store[id] && that.store[id][mime]);
        },
        get: function (id) {
            return that.store[id] && that.store[id][mime];
        }
    };
};

this.Server = function (options) {
    options = options || {};
    this.providers = [];
    this.filters = [];
    this.store = new(Cache);
    this.options = {
        log: options.log || exports.Server.options.log
    };
};

this.Server.options = {
    log: process.stdout
};

this.Server.prototype.map = function (fn) {
    fn.call(this, this);
    return this;
};

this.Server.prototype.use = function (fn) {
    this.filters.push(fn);
    return this;
};

this.Server.prototype.provide = function (mime) {
    var pattern = mime.replace('/', '\\/')
                      .replace('*', '([a-z+0-9_.-]+|\\*)');
    var provider = {
        accept: { pattern: new(RegExp)(pattern), mime: mime },
        incoming: [],
        outgoing: [],
        handler: null
    };
    this.providers.push(provider);

    var that = this;

    var pipe = {};

    Object.keys(filters).forEach(function (k) {
        pipe[k] = function () {
            var functions = filters[k].apply(null, arguments);
            var skip = function (req, res) { res.continue(req, res) };

            provider.incoming.push(functions[0]    || skip); 
            provider.outgoing.unshift(functions[1] || skip);

            return this;
        };
    });

    pipe.bind = function (handler) {
        var pipeline = [];

        provider.handler = function (req, res) {
            var result = (handler instanceof Function) ? handler.call(null, req, res)
                                                       : handler.serve(req, res);
        };

        this.contentType();
        this.log();

        pipeline.push.apply(pipeline, provider.incoming);
        pipeline.push(provider.handler);
        pipeline.push.apply(pipeline, provider.outgoing);
        pipeline.push(function (req, res) {
            res.writeHead(null, {});
            res.end(res.buffer.join(''));
        });

        provider.serve = function (req, res) {
            var response = new(exports.Response)(pipeline, that),
                request  = req;
            response.__proto__ = res;
            res.__proto__      = exports.Response.prototype;
            request.mime       = mime;

            response.return = function (status, headers, data) {
                status  && this.setStatus(status);
                headers && this.setHeaders(headers);
                data    && this.buffer.push(data);
                this.continue(request, response);
            };
            response.continue(request, response);
        };
        return this;
    };
    return pipe;
};

this.Server.prototype.handle = function (request, response) {
    var that = this;
    var promise = new(events.EventEmitter);
    var accept = request.headers.accept || '*/*';
    var mimes = accept.split(/\, */).map(function (mime) {
        var match = mime.match(exports.MIMEPATTERN);
        if (match) {
            return {
                type:    match[1] || match[3],
                subtype: match[2] || match[4],
                qvalue:  parseFloat(match[5]) || 1.0
            };
        } else {
            return { type: '*', subtype: '*', qvalue: 1.0 };
        }
    });

    mimes.sort(function (a, b) {
        var ascore, bscore;

        if (a.qvalue === b.qvalue) {
            ascore = a.type === '*' ? 0 : (a.subtype === '*' ? 1 : 2);
            bscore = b.type === '*' ? 0 : (b.subtype === '*' ? 1 : 2);
            return ascore < bscore ? 1 : -1;
        } else {
            return a.qvalue < b.qvalue ? 1 : -1;
        }
    });

    if (! (function () {
        for (var i = 0, mime; i < mimes.length; i++) {
            mime = [mimes[i].type, mimes[i].subtype].join('/');
            for (var j = 0, handler; j < this.providers.length; j++) {
                provider = this.providers[j];

                if (provider.accept.pattern.test(mime)) {
                    provider.serve(request, response);
                    return true;
                }
            }
        }
    }).call(this)) {
        process.nextTick(function () {
            response.emit('error', { request: request, message: 'no matching providers' }, request, response);
        });
    }
    return response;
};

this.Server.prototype.log = function (request, response, data) {
    var now = new(Date);
    var log = {
        timestamp:  now.toLocaleTimeString() + ' ' + [now.getDate(), now.getMonth() + 1, now.getFullYear()].join('-'),
        responseBody: data,
        url: request.url,
        method: request.method,
        status: response.status,
        requestBody: request.body,
        responseHeaders: response.headers,
        contentType: response.headers['Content-Type'],
        time: response.time,
        httpVersion: response.httpVersion,
        request: request
    };

    if (data) {
        if ((data.length > 256)) {
            data = data.slice(0, 256) + '‥';
        }
        log.responseBody = data.replace(/\n/g, '\\n');
    }

    response.emit('log', log, exports.logger.tty(log), exports.logger.file(log));
};

