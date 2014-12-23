var ctor = require('./constructor'),
    path_module = require('path'),
    queryString = require('querystring'),
    http = require('http'),
    Promise = require('promise'),
    util = require('util');

ctor.prototype.request = function(path, params, fields, method) {
    params = params || {};
    fields = fields || [];
    method = method || this.httpOptions.method;

    var options = {};
    util._extend(options, this.httpOptions);
    options.method = method;
    options.path = path_module.join(this.httpOptions.path, path);

    if (fields.length !== 0) {
        params[fields] = fields.join();
    }
    options.path += '?' + queryString.stringify(params);

    // Add xsrf header
    //var xsrfValue = urlIsSameOrigin(config.url)
    //    ? cookies.read(config.xsrfCookieName || defaults.xsrfCookieName)
    //    : undefined;
    //if (xsrfValue) {
    //    headers[config.xsrfHeaderName || defaults.xsrfHeaderName] = xsrfValue;
    //}
    return new Promise(function (resolve, reject) {
        var req = http.request(options, function (res) {
            var body = '';
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                body += chunk;
            });
            res.on('end', function () {
                var data = JSON.parse(body);
                if (data.error) {
                    reject(data);
                } else {
                    resolve(data.data);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
};