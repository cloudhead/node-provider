
this.buffer = function (block) {
    return [function (req, res) {
        var body = [];
        req.on('data', function (data) { body.push(data) })
           .on('end',  function () {
            req.body = body.join('');
            res.continue(req, res);
        });
    }, null];
};
this.cache = function (req, res) {
    var store = that.store.mime(req.mime);
    return [function (req, res) {
        if (store.exists(req.url)) {
            var object = store.get(req.url);

            res.setHeader('Etag',          '"' + object.etag + '"');
            res.setHeader('Last-Modified', new(Date)(object.mtime).toUTCString());

            if (req.headers['if-none-match'] === object.etag &&
                Date.parse(req.headers['if-modified-since']) >= object.mtime) {
                res.return(304, headers);
            } else {
                res.setHeader('Content-Length', object.data.length);
                res.setHeader('X-Provider',     object.mtime);
                res.return(200, {}, object.data)
            }
        } else {
            res.continue(req, res);
        }
    }, function (req, res, body) {
        store.set(req.url, {
            etag:  md5.digest(data),
            data:  body,
            mtime: Date.now()
        });
    }];
};
this.contentType = function () {
    return [null, function (req, res) {
        if (res.buffer.length > 0) {
            res.setHeader('Content-Type', req.mime);
        }
        res.continue(req, res);
    }];
};
this.log = function (options) {
    return [null, function (req, res) {
        res.time = Date.now() - res.start;
        this.log(req, res, req.body);
        res.continue(req, res);
    }];
};
this.filter = function (incoming, outgoing) {
    return [incoming, outgoing];
};
