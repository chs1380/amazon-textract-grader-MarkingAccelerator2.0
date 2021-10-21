'use strict';

const fs = require('fs');
const gm = require('gm').subClass({
    imageMagick: true,
});
const gs = require('node-gs');
const path = require('path');

let options = {
    type: 'png',
    size: 1024,
    density: 600,
    outputdir: null,
    outputname: null,
    page: null,
};

let Pdf2Img = function () {
};

Pdf2Img.prototype.setOptions = (opts) => {
    options.type = opts.type || options.type;
    options.size = opts.size || options.size;
    options.density = opts.density || options.density;
    options.outputdir = opts.outputdir || options.outputdir;
    options.outputname = opts.outputname || options.outputname;
    options.page = opts.page || options.page;
};

Pdf2Img.prototype.convert = async (input) => {
    // Make sure it has correct extension
    if (path.extname(path.basename(input)) !== '.pdf') {
        return {
            result: 'error',
            message: 'Unsupported file type.',
        };
    }

    // Check if input file exists
    if (!isFileExists(input)) {
        return {
            result: 'error',
            message: 'Input file not found.',
        };
    }

    let output = path.basename(input, path.extname(path.basename(input)));

    // Set output dir
    if (options.outputdir) {
        options.outputdir = options.outputdir + path.sep;
    } else {
        options.outputdir = output + path.sep;
    }

    // Create output dir if it doesn't exists
    if (!isDirExists(options.outputdir)) {
        fs.mkdirSync(options.outputdir, { recursive: true });
    }

    // Set output name
    if (!options.outputname) {
        options.outputname = output;
    }

    const pageCount = await getPageCount(input);
    console.log('pageCount:' + pageCount);

    let inputStream = fs.createReadStream(input);

    let outputFile =
        options.outputdir + options.outputname + '-%d.' + options.type;

    const pageToImages = await convertPdf2Img(inputStream, outputFile, pageCount);
    console.log(pageToImages);
    return pageToImages;
};

const getPageCount = async (input) => {
    return new Promise((resolve, reject) => {
        try {
            gm(input).identify('%p ', (err, value) => {
                if (err) {
                    reject(err);
                }
                console.log('gm identify ->' + value);
                let pageCount = String(value).split(' ');
                if (!pageCount.length) {
                    reject({
                        result: 'error',
                        message: 'Invalid page number.',
                    });
                } else {
                    // Convert selected page
                    if (options.page !== null) {
                        if (options.page < pageCount.length) {
                            resolve(options.page);
                        } else {
                            reject({
                                result: 'error',
                                message: 'Invalid page number.',
                            });
                        }
                    } else {
                        console.log('return pageCount.length');
                        resolve(pageCount.length);
                    }
                }
            });
        } catch (ex) {
            reject(ex);
        }
    });
};
const convertPdf2Img = async (input, output, pageCount) =>
    new Promise((resolve, reject) => {
        let filepath;
        if (input.path) {
            filepath = input.path;
        } else {
            return reject({
                result: 'error',
                message: 'Invalid input file path.',
            });
        }
        console.log(`input:${filepath}, output:${output}`);

        gs()
            .batch()
            .nopause()
            .resolution(options.density)
            .executablePath('/opt/bin/gs')
            .device('png16m')
            .output(output)
            .input(filepath)
            .exec((err, stdout, stderr) => {
                if (stdout) console.log(stdout.toString('utf8'));
                if (stderr) console.log(stderr.toString('utf8'));
                if (err) {
                    return reject({
                        result: 'error',
                        message: err,
                    });
                }
                try {
                    const results = Array.from(Array(pageCount), (_, i) => i + 1).map(
                        (page) => {
                            return {
                                page: page,
                                name: path.basename(output).replace('%d', page),
                                size: fs.statSync(output.replace('%d', page))['size'] / 1000.0,
                                path: output.replace('%d', page),
                            };
                        },
                    );
                    return resolve(results);
                } catch (e) {
                    return reject(e);
                }
            });
    });

// Check if directory is exists
const isDirExists = (path) => {
    try {
        return fs.statSync(path).isDirectory();
    } catch (e) {
        return false;
    }
};

// Check if file is exists
const isFileExists = (path) => {
    try {
        return fs.statSync(path).isFile();
    } catch (e) {
        return false;
    }
};

module.exports = new Pdf2Img();
