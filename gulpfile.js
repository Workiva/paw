var gulp = require('gulp');

// Override default options (such as path) here
var customizedOptions = {
    bundles: {
        global: {
            entry: 'build/src/PawGlobal',
            output: 'dist/PawGlobal.bundle.js',
            sfx: true
        }
    },
    languages: ['javascript']
};

var wGulp = require('wGulp')(gulp, customizedOptions);

// Add your own tasks here
