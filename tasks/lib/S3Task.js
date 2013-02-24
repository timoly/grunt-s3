var path = require("path");

var grunt = require("grunt"),
    _ = grunt.util._,
    async = grunt.util.async;

var S3Task = function(origTask, s3) {
    this._origTask = origTask;
    this.s3 = s3;
};

S3Task.prototype = {
    run: function() {
        var self = this,
            s3 = this.s3;

        var done = this._origTask.async();

        var config = this._getConfig();

        var transfers = [];

        if (config.debug) {
          grunt.log.writeln("Running in debug mode, no transfers will be made".yellow);
          grunt.log.writeln();
        }

        var errors = 0;
        var processJobs = function(doneFn){
          var total = transfers.length;
          var errors = 0;

          var eachTransfer = config.maxOperations > 0 ? 
            async.forEachLimit.bind(async,transfers,config.maxOperations)
            : async.forEach.bind(async,transfers);
          
          eachTransfer(function(transferFn, completed){
            var transfer = transferFn();
            
            transfer.done(function(msg) {
              grunt.log.ok(msg);
              completed();
            });
            
            transfer.fail(function(msg) {
              grunt.log.error(msg);
              ++errors;
              completed();
            });
            
          },function(){
            // we're all done.
            doneFn(!errors);
          });
        };

        var queueRemainingJobs = function(){
          transfers = [];
          config.upload.forEach(function(upload) {
            var uploadFiles = self._parseUploadFiles(upload, config);

            uploadFiles.forEach(function(uploadFile) {
                transfers.push(s3.upload.bind(s3, uploadFile.file, uploadFile.dest, uploadFile.upload));
            });
          });
          config.download.forEach(function(download) {
            transfers.push(s3.download.bind(s3,download.src, download.dest, download));
          });

          config.del.forEach(function(del) {
            transfers.push(s3.del.bind(s3,del.src, del));
          });

          config.copy.forEach(function(copy) {
            transfers.push(s3.copy.bind(s3,copy.src, copy.dest, copy));
          });
          processJobs(done);
        };

        // execute delFolder jobs first
        config.delFolder.forEach(function(del) {
          transfers.push(s3.delFolder.bind(s3,del.src, del, config));
        });
        processJobs(queueRemainingJobs);        
    },

    _parseUploadFiles: function(upload, config) {
        // Expand list of files to upload.
        var files = grunt.file.expand({ filter: "isFile" }, upload.src),
            destPath = grunt.template.process(upload.dest || "");

        return _.map(files, function(file) {
            file = path.resolve(file);
            upload.src = path.resolve(grunt.template.process(upload.src));

            // Put the key, secret and bucket information into the upload for knox
            _.extend(upload, config);

            // If there is only 1 file and it matches the original file wildcard,
            // we know this is a single file transfer. Otherwise, we need to build
            // the destination.
            var dest;
            if (files.length === 1 && file === upload.src) {
              dest = destPath;
            }
            else {
              if (upload.rel) {
                dest = path.join(destPath, path.relative(grunt.file.expand({ filter: "isDirectory" }, upload.rel)[0], file));
              }
              else {
                dest = path.join(destPath, path.basename(file));
              }
            }

            if(config.encodePaths === true) {
              dest = encodeURIComponent(dest);
            }

            return {file: file, dest: dest, upload: upload};
        });
    },

    _getConfig: function() {
        // Grab the options for this task
        var opts = this._origTask.options({
          key : process.env.AWS_ACCESS_KEY_ID,
          secret : process.env.AWS_SECRET_ACCESS_KEY,
          debug: false,
          maxOperations: 0,
          encodePaths: false
        });

        // Grab the actions to perform from the task data, default to empty arrays
        var fileActions = _.defaults(this._origTask.data, {
          upload: [],
          download: [],
          del: [],
          delFolder: [],
          copy: []
        });

        // Combine the options and fileActions as the config
        return _.extend({}, opts, fileActions);
    }
};

module.exports = S3Task;