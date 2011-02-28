
var cutils = require('lib/console-utils');
var http = require('http');

var $ = function (str) {
    return cutils.decorate(str);
};

this.tty = function (l) {
    var log       = [$(l.method).bold, l.url];
    var status    = $(l.status).bold;
    var timestamp = $(l.timestamp).purple;

    l.requestBody && log.push($(l.requestBody).grey);
    status = $(status + ' ' + http.STATUS_CODES[l.status] + '');

    if (l.status >= 500) {
        status = status.red;
    } else if (l.status >= 400) {
        status = status.yellow;
    } else if (l.status >= 300) {
        status = status.cyan;
        if (l.status === 303 || l.status === 302) {
            status += ' ' + $(l.responseHeaders['Location']).cyan;
        }
    } else if (l.status >= 200) {
        status = status.green;
    }

    log = [log.join(' '), '·', status];
    l.contentType  && log.push(l.contentType);
    l.responseBody && log.push($(l.responseBody).grey);
    log.push(('· ' + l.time + ' ms'));
    log = log.join(' ');

    if (this._previousLog === log) {
        return [timestamp, '\x1b[0k' + log + '(' + (++this._counter) + ')'].join(' ');
    } else {
        this._previousLog = log;
        this._counter = 0;
        return [timestamp, log].join(' ');
    }
};

this.file = function (l) {
    return [l.timestamp, l.method, l.url, '--', l.status, l.responseBody].join(' ');
};


